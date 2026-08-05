const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const pool = require('../src/config/database');

const {
    detectAppointmentScope,
    detectIntentMessage,
    detectPersonalIntent,
    isBookingStartIntent,
    normalizeText,
    parseRequestedDate,
    parseRequestedTime,
    parseRequestedTimeWindow,
    scoreKeywords,
    shouldClarifyIntent
} = require('../src/services/chatIntent.service');
const {
    applyBookingEdit,
    createBookingDraft,
    createDialogueStateManager,
    createIntentClarificationState,
    resolveIntentClarification
} = require('../src/services/chatDialogue.service');
const { createChatAppointmentTool } = require('../src/services/chatAppointmentTool.service');

test.after(async () => {
    await pool.end();
});

const operationTopics = {
    payment: ['thanh toan', 'hoa don'],
    reschedule: ['doi lich', 'huy lich'],
    profile: ['ho so kham'],
    doctor: ['bac si nao'],
    opening: ['gio lam viec']
};

test('intent service normalizes Vietnamese and detects operational intent', () => {
    assert.equal(normalizeText('Tôi muốn ĐẶT lịch khám!'), 'toi muon dat lich kham');
    const intent = detectIntentMessage({
        message: 'Tôi muốn thanh toán hóa đơn',
        topic: null,
        operationTopics
    });
    assert.equal(intent.isPayment, true);
    assert.equal(intent.isBooking, false);
    assert.equal(isBookingStartIntent('toi muon hen bac si'), true);
});

test('intent service extracts valid dates and times but rejects invalid calendar dates', () => {
    const now = new Date(2026, 7, 3, 10, 0, 0);
    assert.equal(parseRequestedDate('ngày mai', now), '2026-08-04');
    assert.equal(parseRequestedDate('31/02/2026', now), '');
    assert.equal(parseRequestedTime('14h30'), '14:30');
    assert.equal(parseRequestedTime('25h00'), '');
});

test('intent service detects personal data scopes', () => {
    const normalized = normalizeText('Cho tôi xem tất cả các lịch khám của tôi');
    assert.equal(detectPersonalIntent(normalized).appointment, true);
    assert.equal(detectAppointmentScope(normalized), 'all');
});

test('intent service returns confidence, signals, entities and multiple intents', () => {
    const intent = detectIntentMessage({
        message: 'Cho tôi xem lịch hẹn và hóa đơn của tôi',
        topic: null,
        operationTopics
    });
    assert.equal(intent.primaryIntent, 'patient_appointments');
    assert.ok(intent.confidence >= 0.8);
    assert.ok(intent.detectedIntents.includes('patient_appointments'));
    assert.ok(intent.detectedIntents.includes('patient_invoices'));
    assert.ok(Array.isArray(intent.matchedSignals));
    assert.equal(typeof intent.entities, 'object');
});

test('emergency intent takes priority over booking intent', () => {
    const intent = detectIntentMessage({
        message: 'Tôi bị sưng mặt và muốn đặt lịch ngay',
        topic: { id: 'emergency' },
        operationTopics
    });
    assert.equal(intent.primaryIntent, 'emergency');
    assert.ok(intent.detectedIntents.includes('booking'));
    assert.ok(intent.confidence >= 0.95);
});

test('unknown message requests clarification but greeting does not', () => {
    const unknown = detectIntentMessage({ message: 'kiểm tra giúp tôi', topic: null, operationTopics });
    const greeting = detectIntentMessage({ message: 'xin chào', topic: null, operationTopics });
    assert.equal(shouldClarifyIntent(unknown), true);
    assert.equal(shouldClarifyIntent(greeting), false);
});

test('keyword scoring does not accumulate a common token across unrelated phrases', () => {
    const score = scoreKeywords('cho tôi hỏi giờ làm việc', [
        'hôi miệng', 'mùi hôi', 'hơi thở có mùi', 'miệng hôi'
    ]);
    assert.ok(score < 2);
});

test('keyword scoring does not confuse tre gio with tre em after accent removal', () => {
    const score = scoreKeywords('tôi bị trễ giờ hẹn', [
        'trẻ em', 'răng sữa', 'bé đau răng', 'nha khoa trẻ em'
    ]);
    assert.ok(score < 2);
});

test('clarification is skipped while booking or personal-data flow is active', () => {
    const unknown = detectIntentMessage({ message: 'kiểm tra giúp tôi', topic: null, operationTopics });
    assert.equal(shouldClarifyIntent(unknown, { isInBookingFlow: true }), false);
    assert.equal(shouldClarifyIntent(unknown, { hasPersonalDataIntent: true }), false);
});

test('date parser understands day after tomorrow and relative day offsets', () => {
    const now = new Date(2026, 7, 4, 10, 0, 0);
    assert.equal(parseRequestedDate('ngày kia', now), '2026-08-06');
    assert.equal(parseRequestedDate('3 ngày nữa', now), '2026-08-07');
});

test('date parser understands Vietnamese weekdays and next week', () => {
    const tuesday = new Date(2026, 7, 4, 10, 0, 0);
    assert.equal(parseRequestedDate('thứ bảy', tuesday), '2026-08-08');
    assert.equal(parseRequestedDate('thứ bảy tuần sau', tuesday), '2026-08-15');
    assert.equal(parseRequestedDate('chủ nhật tuần sau', tuesday), '2026-08-16');
});

test('time-window parser understands morning, afternoon and evening periods', () => {
    assert.deepEqual(parseRequestedTimeWindow('sáng mai'), {
        keywords: ['buoi sang', 'sang som', 'sang'],
        label: 'buổi sáng',
        startMinutes: 420,
        endMinutes: 720,
        source: 'period'
    });
    assert.equal(parseRequestedTimeWindow('chiều mai').startMinutes, 780);
    assert.equal(parseRequestedTimeWindow('buổi tối ngày kia').endMinutes, 1260);
});

test('time-window parser understands before, after and explicit ranges', () => {
    assert.deepEqual(parseRequestedTimeWindow('sau 17 giờ'), {
        label: 'sau 17:00',
        startMinutes: 1020,
        endMinutes: 1439,
        source: 'after'
    });
    assert.equal(parseRequestedTimeWindow('trước 10h').endMinutes, 600);
    const range = parseRequestedTimeWindow('từ 14h đến 17h');
    assert.equal(range.startMinutes, 840);
    assert.equal(range.endMinutes, 1020);
    assert.equal(range.source, 'range');
});

test('comparative time is exposed as a window instead of an exact appointment time', () => {
    const intent = detectIntentMessage({
        message: 'Tôi muốn khám sau 17 giờ ngày mai',
        topic: null,
        operationTopics
    });
    assert.match(intent.entities.date, /^20\d{2}-\d{2}-\d{2}$/);
    assert.equal(intent.entities.time, '');
    assert.equal(intent.entities.timeWindow.source, 'after');
});

test('Vietnamese pronoun toi is not mistaken for an evening period', () => {
    assert.equal(parseRequestedTimeWindow('tôi muốn đặt lịch'), null);
});

test('dialogue manager preserves draft and resets dependent fields when editing', () => {
    const draft = createBookingDraft({
        draft: {
            serviceIds: [1],
            appointmentDate: '2026-08-10',
            appointmentTime: '09:00',
            appointmentTimeSource: 'explicit',
            dentistId: 2
        }
    });
    const edited = applyBookingEdit(draft, 'date');
    assert.deepEqual(edited.serviceIds, [1]);
    assert.equal(edited.dentistId, 2);
    assert.equal(edited.appointmentDate, '');
    assert.equal(edited.appointmentTime, '');
});

test('booking draft stores a time window and clears it when time is edited', () => {
    const draft = createBookingDraft({
        draft: {
            appointmentTime: '15:00',
            appointmentTimeSource: 'explicit',
            timeWindow: { label: 'buổi chiều', startMinutes: 780, endMinutes: 1050 }
        }
    });
    const edited = applyBookingEdit(draft, 'time');
    assert.equal(edited.appointmentTime, '');
    assert.equal(edited.appointmentTimeSource, '');
    assert.equal(edited.timeWindow, null);
});

test('intent clarification resolves both numeric and named choices', () => {
    const state = createIntentClarificationState('kiểm tra giúp tôi');
    assert.equal(resolveIntentClarification(state, '2').id, 'appointments');
    assert.equal(resolveIntentClarification(state, 'Xem hóa đơn').id, 'invoices');
    assert.equal(resolveIntentClarification(state, 'không rõ'), null);
});

test('dialogue state manager clears an expired persisted state', async () => {
    const queries = [];
    const database = {
        query: async (sql, params) => {
            queries.push({ sql, params });
            if (sql.startsWith('SELECT')) {
                return [[{
                    assistantState: JSON.stringify({
                        mode: 'booking',
                        updatedAt: '2020-01-01T00:00:00.000Z'
                    })
                }]];
            }
            return [{ affectedRows: 1 }];
        }
    };
    const manager = createDialogueStateManager(database);
    assert.equal(await manager.get(9), null);
    assert.equal(queries.length, 2);
    assert.match(queries[1].sql, /assistantState = NULL/);
});

test('appointment tool commits on success and always releases the connection', async () => {
    const events = [];
    const connection = {
        beginTransaction: async () => events.push('begin'),
        commit: async () => events.push('commit'),
        rollback: async () => events.push('rollback'),
        release: () => events.push('release')
    };
    const tool = createChatAppointmentTool({
        database: { getConnection: async () => connection },
        createRecord: async (_connection, input) => {
            events.push(`create:${input.patientId}`);
            return { appointmentId: 42 };
        }
    });

    assert.deepEqual(await tool.execute({ patientId: 7 }), { appointmentId: 42 });
    assert.deepEqual(events, ['begin', 'create:7', 'commit', 'release']);
});

test('appointment tool rolls back and releases when creation fails', async () => {
    const events = [];
    const connection = {
        beginTransaction: async () => events.push('begin'),
        commit: async () => events.push('commit'),
        rollback: async () => events.push('rollback'),
        release: () => events.push('release')
    };
    const tool = createChatAppointmentTool({
        database: { getConnection: async () => connection },
        createRecord: async () => { throw new Error('slot unavailable'); }
    });

    await assert.rejects(() => tool.execute({ patientId: 7 }), /slot unavailable/);
    assert.deepEqual(events, ['begin', 'rollback', 'release']);
});
