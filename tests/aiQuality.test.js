const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const {
    attachQualityTelemetry,
    buildQualityTelemetry,
    queueTrainingSample,
    summarizeAiQuality
} = require('../src/services/aiQuality.service');

test('quality telemetry accepts a confident grounded answer', () => {
    const quality = buildQualityTelemetry({
        intent: 'patient_invoices',
        confidence: 0.92,
        grounded: true,
        groundingConfidence: 1,
        aiMode: 'local'
    });

    assert.equal(quality.reviewRecommended, false);
    assert.deepEqual(quality.reviewReasons, []);
});

test('quality telemetry flags general and ungrounded answers', () => {
    const quality = buildQualityTelemetry({ intent: 'general', confidence: 0.42, grounded: false });

    assert.equal(quality.reviewRecommended, true);
    assert.ok(quality.reviewReasons.some((reason) => reason.includes('intent')));
    assert.ok(quality.reviewReasons.some((reason) => reason.includes('grounding')));
});

test('quality telemetry flags LLM fallback but not clarification grounding', () => {
    const fallback = buildQualityTelemetry({
        intent: 'service_advice',
        confidence: 0.8,
        grounded: true,
        aiMode: 'local_fallback'
    });
    const clarification = buildQualityTelemetry({
        intent: 'intent_clarification',
        confidence: 0.3,
        grounded: false
    });

    assert.equal(fallback.reviewRecommended, true);
    assert.equal(clarification.reviewRecommended, false);
});

test('attaching telemetry promotes review flags to training metadata', () => {
    const metadata = attachQualityTelemetry({ intent: 'general', confidence: 0.4 });

    assert.equal(metadata.quality.version, 'v5');
    assert.equal(metadata.needsTrainingReview, true);
    assert.ok(metadata.trainingReason.length > 0);
});

test('training queue inserts once and deduplicates a recent pending sample', async () => {
    const calls = [];
    let duplicate = false;
    const database = {
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (sql.includes('SELECT id')) return [duplicate ? [{ id: 19 }] : []];
            duplicate = true;
            return [{ insertId: 19 }];
        }
    };
    const payload = {
        database,
        patientId: 7,
        userMessage: 'Cho tôi hỏi một câu chưa rõ',
        assistantReply: 'Bạn vui lòng nói rõ hơn.',
        metadata: attachQualityTelemetry({ intent: 'general', confidence: 0.3 })
    };

    const first = await queueTrainingSample(payload);
    const second = await queueTrainingSample(payload);

    assert.deepEqual(first, { inserted: true, id: 19 });
    assert.deepEqual(second, { inserted: false, duplicateId: 19 });
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO AiTrainingSamples')).length, 1);
});

test('quality summary aggregates grounding, feedback and intent metrics', () => {
    const messages = [
        {
            id: 1,
            createdAt: '2026-08-04T08:00:00.000Z',
            metadata: JSON.stringify(attachQualityTelemetry({
                intent: 'patient_invoices', confidence: 0.9, grounded: true, groundingConfidence: 1
            }))
        },
        {
            id: 2,
            createdAt: '2026-08-05T08:00:00.000Z',
            metadata: JSON.stringify(attachQualityTelemetry({
                intent: 'general', confidence: 0.4, grounded: false
            }))
        },
        {
            id: 3,
            createdAt: '2026-08-05T09:00:00.000Z',
            metadata: JSON.stringify({ intent: 'legacy_answer' })
        }
    ];
    const feedback = [
        { messageId: 1, rating: 'helpful' },
        { messageId: 2, rating: 'unhelpful' }
    ];

    const result = summarizeAiQuality({ messages, feedback, days: 30 });

    assert.equal(result.totalResponses, 2);
    assert.equal(result.observedResponses, 3);
    assert.equal(result.legacyResponses, 1);
    assert.equal(result.telemetryCoverage, 0.667);
    assert.equal(result.helpfulRate, 0.5);
    assert.equal(result.groundedRate, 0.5);
    assert.equal(result.reviewRecommended, 1);
    assert.equal(result.byIntent[0].responses, 1);
    assert.equal(result.daily.length, 2);
});
