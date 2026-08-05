const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ChatMessageGuard,
    KeyedTaskQueue,
    isAssistantStateExpired,
    normalizeClientMessageId,
    publicBookingError
} = require('../src/utils/chatPolicy');

const config = {
    maxMessageLength: 20,
    rateLimitWindowMs: 1000,
    rateLimitMax: 2,
    dedupeTtlMs: 5000,
    assistantStateTtlMs: 30 * 60 * 1000
};

test('assistant state expires after the configured TTL', () => {
    const now = Date.parse('2026-08-03T10:00:00.000Z');
    assert.equal(isAssistantStateExpired({ updatedAt: '2026-08-03T09:45:00.000Z' }, config.assistantStateTtlMs, now), false);
    assert.equal(isAssistantStateExpired({ updatedAt: '2026-08-03T09:00:00.000Z' }, config.assistantStateTtlMs, now), true);
    assert.equal(isAssistantStateExpired({ updatedAt: 'invalid' }, config.assistantStateTtlMs, now), true);
});

test('message guard rejects oversized, duplicate and excessive messages', () => {
    const guard = new ChatMessageGuard(config);
    const firstId = 'chat-message-0001';

    assert.equal(guard.check({ userId: 7, message: 'a'.repeat(21), clientMessageId: firstId, now: 1000 }).code, 'too_long');
    assert.equal(guard.check({ userId: 7, message: 'Xin chao', clientMessageId: firstId, now: 1100 }).ok, true);
    assert.equal(guard.check({ userId: 7, message: 'Xin chao', clientMessageId: firstId, now: 1200 }).code, 'duplicate');
    assert.equal(guard.check({ userId: 7, message: 'Dat lich', clientMessageId: 'chat-message-0002', now: 1300 }).ok, true);
    assert.equal(guard.check({ userId: 7, message: 'Them tin', clientMessageId: 'chat-message-0003', now: 1400 }).code, 'rate_limit');
});

test('client message id only accepts a bounded safe format', () => {
    assert.equal(normalizeClientMessageId('chat-12345678'), 'chat-12345678');
    assert.equal(normalizeClientMessageId('bad id'), '');
    assert.equal(normalizeClientMessageId('x'.repeat(101)), '');
});

test('booking errors expose business messages but hide internal errors', () => {
    assert.equal(
        publicBookingError(new Error('Cần đặt lịch trước ít nhất 24 giờ.')),
        'Cần đặt lịch trước ít nhất 24 giờ.'
    );
    assert.equal(
        publicBookingError(new Error('ER_LOCK_DEADLOCK: internal database detail')),
        'Hệ thống chưa thể tạo lịch ở thời điểm này. Bạn vui lòng chọn giờ khác hoặc gặp nhân viên hỗ trợ.'
    );
});

test('keyed queue runs tasks for the same patient sequentially', async () => {
    const queue = new KeyedTaskQueue();
    const events = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

    const first = queue.run('patient:1', async () => {
        events.push('first:start');
        await firstGate;
        events.push('first:end');
    });
    const second = queue.run('patient:1', async () => {
        events.push('second:start');
        events.push('second:end');
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});
