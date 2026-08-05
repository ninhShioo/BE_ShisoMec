const QUALITY_VERSION = 'v5';
const DEFAULT_CONFIDENCE_THRESHOLD = 0.55;
const GROUNDING_OPTIONAL_INTENTS = new Set([
    'greeting',
    'intent_clarification',
    'human_support',
    'booking_cancelled'
]);

const parseMetadata = (value) => {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
};

const clampScore = (value) => {
    const score = Number(value);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(1, score));
};

const buildQualityTelemetry = (metadata = {}, { confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD } = {}) => {
    const intent = String(metadata.intent || 'general');
    const confidence = clampScore(metadata.confidence);
    const groundingConfidence = clampScore(metadata.groundingConfidence);
    const grounded = Boolean(metadata.grounded);
    const reasons = [];

    if (metadata.needsTrainingReview) reasons.push(metadata.trainingReason || 'Câu trả lời đã được đánh dấu cần review.');
    if (intent === 'general') reasons.push('Chưa xác định được intent cụ thể.');
    if (confidence > 0 && confidence < confidenceThreshold && intent !== 'intent_clarification') reasons.push('Độ tin cậy intent thấp.');
    if (!grounded && !GROUNDING_OPTIONAL_INTENTS.has(intent)) reasons.push('Câu trả lời chưa có nguồn grounding.');
    if (metadata.aiMode === 'local_fallback') reasons.push('Dịch vụ LLM lỗi và hệ thống đã dùng fallback local.');

    return {
        version: QUALITY_VERSION,
        intent,
        confidence,
        grounded,
        groundingConfidence,
        aiMode: metadata.aiMode || 'local',
        needsStaff: Boolean(metadata.needsStaff),
        reviewRecommended: reasons.length > 0,
        reviewReasons: [...new Set(reasons)]
    };
};

const attachQualityTelemetry = (metadata = {}) => {
    const quality = buildQualityTelemetry(metadata);
    return {
        ...metadata,
        quality,
        needsTrainingReview: Boolean(metadata.needsTrainingReview || quality.reviewRecommended),
        trainingReason: metadata.trainingReason || quality.reviewReasons.join(' ')
    };
};

const queueTrainingSample = async ({
    database,
    patientId,
    userMessage,
    assistantReply,
    metadata = {},
    reviewReason = ''
}) => {
    if (!database?.query || !Number.isInteger(Number(patientId)) || Number(patientId) <= 0) return { inserted: false };
    const question = String(userMessage || '').trim().slice(0, 2000);
    if (!question) return { inserted: false };

    const [recentSamples] = await database.query(
        `SELECT id
         FROM AiTrainingSamples
         WHERE patientId = ?
           AND userMessage = ?
           AND status = "pending"
           AND createdAt >= DATE_SUB(NOW(), INTERVAL 1 DAY)
         LIMIT 1`,
        [patientId, question]
    );
    if (recentSamples.length > 0) return { inserted: false, duplicateId: recentSamples[0].id };

    const quality = metadata.quality || buildQualityTelemetry(metadata);
    const reason = String(
        reviewReason
        || metadata.trainingReason
        || quality.reviewReasons.join(' ')
        || 'Cần admin kiểm tra câu trả lời AI.'
    ).slice(0, 255);
    const [result] = await database.query(
        `INSERT INTO AiTrainingSamples
         (patientId, userMessage, assistantReply, intent, reviewReason)
         VALUES (?, ?, ?, ?, ?)`,
        [
            patientId,
            question,
            String(assistantReply || '').slice(0, 10000),
            metadata.intent || 'general',
            reason
        ]
    );

    return { inserted: true, id: result.insertId };
};

const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits));

const summarizeAiQuality = ({ messages = [], feedback = [], days = 30 } = {}) => {
    const feedbackByMessage = new Map();
    feedback.forEach((item) => {
        const key = Number(item.messageId);
        const current = feedbackByMessage.get(key) || { helpful: 0, unhelpful: 0 };
        if (item.rating === 'helpful') current.helpful += 1;
        if (item.rating === 'unhelpful') current.unhelpful += 1;
        feedbackByMessage.set(key, current);
    });

    const byIntent = new Map();
    const byAiMode = new Map();
    const daily = new Map();
    let groundedResponses = 0;
    let reviewRecommended = 0;
    let confidenceTotal = 0;
    let confidenceCount = 0;
    let groundingConfidenceTotal = 0;
    let analyzedResponses = 0;
    let legacyResponses = 0;

    messages.forEach((message) => {
        const metadata = parseMetadata(message.metadata);
        const hasTelemetry = Boolean(metadata.quality)
            || Object.prototype.hasOwnProperty.call(metadata, 'grounded');
        if (!hasTelemetry) {
            legacyResponses += 1;
            return;
        }

        analyzedResponses += 1;
        const quality = metadata.quality || buildQualityTelemetry(metadata);
        const messageFeedback = feedbackByMessage.get(Number(message.id)) || { helpful: 0, unhelpful: 0 };
        const intent = quality.intent || metadata.intent || 'general';
        const mode = quality.aiMode || metadata.aiMode || 'local';
        const day = String(message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt || '').slice(0, 10) || 'unknown';

        if (quality.grounded) groundedResponses += 1;
        if (quality.reviewRecommended) reviewRecommended += 1;
        if (quality.confidence > 0) {
            confidenceTotal += quality.confidence;
            confidenceCount += 1;
        }
        groundingConfidenceTotal += quality.groundingConfidence;

        const intentRow = byIntent.get(intent) || { intent, responses: 0, grounded: 0, reviewRecommended: 0, helpful: 0, unhelpful: 0, confidenceTotal: 0, confidenceCount: 0 };
        intentRow.responses += 1;
        intentRow.grounded += quality.grounded ? 1 : 0;
        intentRow.reviewRecommended += quality.reviewRecommended ? 1 : 0;
        intentRow.helpful += messageFeedback.helpful;
        intentRow.unhelpful += messageFeedback.unhelpful;
        if (quality.confidence > 0) {
            intentRow.confidenceTotal += quality.confidence;
            intentRow.confidenceCount += 1;
        }
        byIntent.set(intent, intentRow);

        byAiMode.set(mode, (byAiMode.get(mode) || 0) + 1);
        const dailyRow = daily.get(day) || { date: day, responses: 0, grounded: 0, reviewRecommended: 0, helpful: 0, unhelpful: 0 };
        dailyRow.responses += 1;
        dailyRow.grounded += quality.grounded ? 1 : 0;
        dailyRow.reviewRecommended += quality.reviewRecommended ? 1 : 0;
        dailyRow.helpful += messageFeedback.helpful;
        dailyRow.unhelpful += messageFeedback.unhelpful;
        daily.set(day, dailyRow);
    });

    const helpful = feedback.filter((item) => item.rating === 'helpful').length;
    const unhelpful = feedback.filter((item) => item.rating === 'unhelpful').length;
    const totalFeedback = helpful + unhelpful;
    const observedResponses = messages.length;
    const totalResponses = analyzedResponses;

    return {
        days: Number(days),
        observedResponses,
        totalResponses,
        legacyResponses,
        telemetryCoverage: observedResponses ? round(totalResponses / observedResponses) : 0,
        totalFeedback,
        helpful,
        unhelpful,
        helpfulRate: totalFeedback ? round(helpful / totalFeedback) : 0,
        groundedResponses,
        groundedRate: totalResponses ? round(groundedResponses / totalResponses) : 0,
        reviewRecommended,
        reviewRate: totalResponses ? round(reviewRecommended / totalResponses) : 0,
        averageConfidence: confidenceCount ? round(confidenceTotal / confidenceCount) : 0,
        averageGroundingConfidence: totalResponses ? round(groundingConfidenceTotal / totalResponses) : 0,
        byIntent: [...byIntent.values()].map((row) => ({
            intent: row.intent,
            responses: row.responses,
            groundedRate: row.responses ? round(row.grounded / row.responses) : 0,
            reviewRecommended: row.reviewRecommended,
            helpful: row.helpful,
            unhelpful: row.unhelpful,
            helpfulRate: row.helpful + row.unhelpful ? round(row.helpful / (row.helpful + row.unhelpful)) : 0,
            averageConfidence: row.confidenceCount ? round(row.confidenceTotal / row.confidenceCount) : 0
        })).sort((a, b) => b.responses - a.responses),
        byAiMode: [...byAiMode.entries()].map(([mode, responses]) => ({ mode, responses })).sort((a, b) => b.responses - a.responses),
        daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date))
    };
};

module.exports = {
    DEFAULT_CONFIDENCE_THRESHOLD,
    QUALITY_VERSION,
    attachQualityTelemetry,
    buildQualityTelemetry,
    parseMetadata,
    queueTrainingSample,
    summarizeAiQuality
};
