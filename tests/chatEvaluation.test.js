const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const {
    detectIntentMessage,
    parseRequestedDate,
    parseRequestedTimeWindow
} = require('../src/services/chatIntent.service');
const { rankKnowledgeItems } = require('../src/services/chatKnowledge.service');

const operationTopics = {
    payment: ['thanh toan', 'vnpay', 'hoa don', 'chuyen khoan'],
    reschedule: ['doi lich', 'huy lich', 'doi gio', 'doi ngay'],
    profile: ['ho so kham', 'lich su kham'],
    doctor: ['bac si nao'],
    opening: ['gio lam viec', 'mo cua', 'hotline']
};

const intentScenarios = [
    ['Tôi muốn đặt lịch khám', 'booking'],
    ['Cho tôi xem lịch hẹn của tôi', 'patient_appointments'],
    ['Tôi còn hóa đơn nào chưa thanh toán?', 'patient_invoices'],
    ['Tôi muốn gặp nhân viên hỗ trợ', 'human_support'],
    ['Phòng khám mở cửa lúc nào?', 'opening_hours'],
    ['Tôi muốn thanh toán bằng VNPay', 'payment'],
    ['Tôi cần đổi lịch sang ngày khác', 'reschedule'],
    ['Xin chào', 'greeting']
];

test('AI intent evaluation scenarios remain above the acceptance threshold', () => {
    const passed = intentScenarios.filter(([message, expected]) => {
        const result = detectIntentMessage({ message, topic: null, operationTopics });
        return result.primaryIntent === expected;
    }).length;

    const accuracy = passed / intentScenarios.length;
    assert.ok(accuracy >= 0.9, `Intent accuracy ${accuracy * 100}% is below 90%`);
});

test('AI temporal evaluation covers relative dates and time windows', () => {
    const now = new Date(2026, 7, 5, 9, 0, 0);
    const scenarios = [
        [parseRequestedDate('ngày mai', now), '2026-08-06'],
        [parseRequestedDate('ngày kia', now), '2026-08-07'],
        [parseRequestedDate('thứ bảy tuần sau', now), '2026-08-15'],
        [parseRequestedTimeWindow('buổi sáng')?.source, 'period'],
        [parseRequestedTimeWindow('sau 17 giờ')?.source, 'after'],
        [parseRequestedTimeWindow('từ 14h đến 17h')?.source, 'range']
    ];
    assert.ok(scenarios.every(([actual, expected]) => actual === expected));
});

test('AI knowledge evaluation selects the grounded answer and rejects unrelated content', () => {
    const items = [
        { id: 'late', title: 'Đến muộn', keywords: ['đến muộn', 'trễ giờ'], answer: 'Liên hệ lễ tân.' },
        { id: 'warranty', title: 'Bảo hành răng sứ', keywords: ['bảo hành răng sứ'], answer: 'Xem chính sách.' },
        { id: 'hours', title: 'Giờ làm việc', keywords: ['giờ làm việc', 'mở cửa'], answer: 'Xem settings.' }
    ];

    assert.equal(rankKnowledgeItems('Tôi bị trễ giờ', items)[0]?.id, 'late');
    assert.equal(rankKnowledgeItems('Bảo hành răng sứ thế nào?', items)[0]?.id, 'warranty');
    assert.equal(rankKnowledgeItems('Nội dung không liên quan', items).length, 0);
});
