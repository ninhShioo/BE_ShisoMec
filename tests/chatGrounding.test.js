const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const {
    createKnowledgeRetriever,
    rankKnowledgeItems,
    scoreKnowledgeItem,
    tokenize
} = require('../src/services/chatKnowledge.service');
const {
    extractGroundedFacts,
    findUnsupportedFacts,
    validateGroundedReply
} = require('../src/services/aiChat.service');

test('knowledge tokenizer removes conversational stop words', () => {
    assert.deepEqual(tokenize('Tôi muốn hỏi về lịch tái khám của tôi'), ['lich', 'tai', 'kham']);
});

test('knowledge scoring strongly rewards an exact multi-word keyword', () => {
    const result = scoreKnowledgeItem('Phòng khám có bảo hành răng sứ không?', {
        title: 'Bảo hành phục hình',
        keywords: ['bảo hành răng sứ', 'phục hình'],
        category: 'policy'
    });
    assert.ok(result.score >= 0.8);
    assert.ok(result.matchedSignals.some((signal) => signal.startsWith('keyword:')));
});

test('knowledge scoring ignores common-token false positives', () => {
    const result = scoreKnowledgeItem('Cho tôi hỏi giờ làm việc', {
        title: 'Hôi miệng',
        keywords: ['hôi miệng', 'mùi hôi', 'hơi thở có mùi'],
        category: 'clinical'
    });
    assert.ok(result.score < 0.48);
});

test('knowledge ranking applies threshold and orders by confidence', () => {
    const ranked = rankKnowledgeItems('Tôi cần biết chính sách bảo hành răng sứ', [
        { id: 1, title: 'Giờ làm việc', keywords: ['mở cửa'], answer: 'A' },
        { id: 2, title: 'Bảo hành răng sứ', keywords: ['bảo hành răng sứ'], answer: 'B' }
    ]);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, 2);
});

test('knowledge retriever combines database and builtin knowledge with source metadata', async () => {
    const database = {
        query: async () => [[{
            id: 7,
            title: 'Chính sách bảo hành',
            category: 'policy',
            keywords: 'bảo hành răng sứ, bảo hành phục hình',
            answer: 'Nội dung từ database.',
            updatedAt: '2026-08-05T00:00:00.000Z'
        }]]
    };
    const retriever = createKnowledgeRetriever({
        database,
        builtinItems: [{ id: 'hours', title: 'Giờ làm việc', keywords: ['mở cửa'], answer: 'Nội dung local.' }]
    });
    const result = await retriever.retrieve('Bảo hành răng sứ như thế nào?');
    assert.equal(result.bestMatch.id, 'db_7');
    assert.equal(result.sources[0].source, 'database');
    assert.ok(result.confidence >= 0.8);
});

test('knowledge retriever falls back to builtin items when database is unavailable', async () => {
    const retriever = createKnowledgeRetriever({
        database: { query: async () => { throw new Error('database unavailable'); } },
        builtinItems: [{ id: 'first_visit', title: 'Khám lần đầu', keywords: ['kham lan dau'], answer: 'Mang giấy tờ.' }]
    });
    const result = await retriever.retrieve('Tôi đi khám lần đầu');
    assert.equal(result.bestMatch.id, 'first_visit');
    assert.equal(result.sources[0].source, 'builtin');
});

test('knowledge retriever returns no source when confidence is below threshold', async () => {
    const retriever = createKnowledgeRetriever({
        builtinItems: [{ id: 'implant', title: 'Implant', keywords: ['cấy ghép implant'], answer: 'A' }]
    });
    const result = await retriever.retrieve('Tôi cần thông tin hoàn toàn khác');
    assert.equal(result.bestMatch, null);
    assert.deepEqual(result.sources, []);
});

test('knowledge retriever falls back to the default threshold for invalid configuration', async () => {
    const retriever = createKnowledgeRetriever({
        threshold: Number.NaN,
        builtinItems: [{ id: 'hours', title: 'Giờ làm việc', keywords: ['giờ làm việc'], answer: 'A' }]
    });
    const result = await retriever.retrieve('Cho tôi xem giờ làm việc');
    assert.equal(result.bestMatch.id, 'hours');
});

test('grounding fact extractor identifies protected facts', () => {
    const facts = extractGroundedFacts('Lịch #54 lúc 14:30, giá 300.000 đ. Xem https://example.com hoặc gọi 0869800318.');
    assert.ok(facts.some((fact) => fact.type === 'entityId'));
    assert.ok(facts.some((fact) => fact.type === 'time'));
    assert.ok(facts.some((fact) => fact.type === 'money'));
    assert.ok(facts.some((fact) => fact.type === 'url'));
    assert.ok(facts.some((fact) => fact.type === 'phone'));
});

test('grounded reply validator accepts facts already present in the draft', () => {
    const validation = validateGroundedReply({
        reply: 'Hóa đơn #25 còn 300.000 đ và phòng khám mở lúc 08:00.',
        draftReply: 'Hóa đơn #25 còn 300.000 đ. Giờ mở cửa 08:00.',
        settings: {}
    });
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.unsupportedFacts, []);
});

test('grounded reply validator rejects invented price, time and URL', () => {
    const unsupported = findUnsupportedFacts(
        'Chi phí 500.000 đ, hẹn 19:30 tại https://fake.example.',
        'Chi phí 300.000 đ, hẹn 18:00 tại https://clinic.example.'
    );
    assert.ok(unsupported.some((fact) => fact.type === 'money'));
    assert.ok(unsupported.some((fact) => fact.type === 'time'));
    assert.ok(unsupported.some((fact) => fact.type === 'url'));
});
