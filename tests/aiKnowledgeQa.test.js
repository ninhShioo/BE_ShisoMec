const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { buildKnowledgeQaReport } = require('../src/services/aiKnowledgeQa.service');

test('knowledge QA accepts a detailed candidate with useful keywords', () => {
    const report = buildKnowledgeQaReport({
        candidate: {
            title: 'Chăm sóc sau nhổ răng',
            category: 'clinical',
            keywords: 'chăm sóc sau nhổ răng, kiêng gì sau nhổ răng',
            answer: 'Sau khi nhổ răng, khách nên cắn gạc theo hướng dẫn, tránh súc miệng mạnh và liên hệ phòng khám nếu chảy máu kéo dài.'
        },
        testQuestions: ['Sau khi nhổ răng tôi cần kiêng gì?']
    });

    assert.equal(report.ready, true);
    assert.ok(report.readinessScore >= 80);
    assert.equal(report.preview[0].candidateRank, 1);
    assert.equal(report.preview[0].passesThreshold, true);
});

test('knowledge QA rejects short answers and meaningless keywords', () => {
    const report = buildKnowledgeQaReport({
        candidate: {
            title: 'Thông tin',
            keywords: 'và, là, của',
            answer: 'Chưa rõ.'
        }
    });

    assert.equal(report.ready, false);
    assert.ok(report.errors.some((error) => error.includes('30 ký tự')));
    assert.ok(report.errors.some((error) => error.includes('từ khóa')));
});

test('knowledge QA detects duplicate titles and keyword conflicts', () => {
    const report = buildKnowledgeQaReport({
        candidate: {
            title: 'Giờ làm việc',
            keywords: 'giờ làm việc, phòng khám mở cửa',
            answer: 'Phòng khám làm việc theo khung giờ được công bố trong phần thông tin liên hệ của hệ thống.'
        },
        existingItems: [{
            id: 9,
            title: 'Giờ làm việc',
            keywords: 'giờ làm việc, lịch mở cửa',
            answer: 'Nội dung hiện có.'
        }]
    });

    assert.equal(report.ready, false);
    assert.equal(report.conflicts.length, 1);
    assert.ok(report.errors.some((error) => error.includes('tri thức #9')));
});

test('knowledge QA warns when another item ranks above the candidate', () => {
    const report = buildKnowledgeQaReport({
        candidate: {
            title: 'Tư vấn răng',
            keywords: 'răng khôn, tư vấn răng',
            answer: 'Khách nên mô tả vị trí đau và đặt lịch khám để bác sĩ đánh giá trực tiếp tình trạng răng.'
        },
        existingItems: [{
            id: 3,
            title: 'Đau răng khôn',
            keywords: 'đau răng khôn, răng khôn',
            answer: 'Nội dung hiện có.'
        }],
        testQuestions: ['Tôi bị đau răng khôn']
    });

    assert.ok(report.preview[0].topMatches.length >= 1);
    assert.ok(report.warnings.some((warning) => warning.includes('tri thức khác')));
});

test('knowledge QA rejects an explicit test question that does not match', () => {
    const report = buildKnowledgeQaReport({
        candidate: {
            title: 'Chăm sóc răng sứ',
            keywords: 'chăm sóc răng sứ, vệ sinh răng sứ',
            answer: 'Khách nên vệ sinh đúng cách và tái khám định kỳ để bác sĩ kiểm tra tình trạng phục hình răng sứ.'
        },
        testQuestions: ['Phòng khám có mở cửa chủ nhật không?']
    });

    assert.equal(report.ready, false);
    assert.ok(report.errors.some((error) => error.includes('câu hỏi kiểm tra')));
});
