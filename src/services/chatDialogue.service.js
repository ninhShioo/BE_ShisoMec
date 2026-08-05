const pool = require('../config/database');
const { getChatPolicyConfig, isAssistantStateExpired } = require('../utils/chatPolicy');

const parseJsonSafe = (value, fallback = null) => {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const createDialogueStateManager = (database = pool) => ({
    get: async (patientId) => {
        const [[conversation]] = await database.query(
            'SELECT assistantState FROM ChatConversations WHERE patientId = ? LIMIT 1',
            [patientId]
        );
        const state = parseJsonSafe(conversation?.assistantState, null);
        if (!state) return null;

        if (isAssistantStateExpired(state, getChatPolicyConfig().assistantStateTtlMs)) {
            await database.query(
                `UPDATE ChatConversations
                 SET assistantState = NULL, updatedAt = CURRENT_TIMESTAMP
                 WHERE patientId = ?`,
                [patientId]
            );
            return null;
        }
        return state;
    },

    save: async (patientId, state) => {
        const persistedState = state ? {
            ...state,
            updatedAt: state.updatedAt || new Date().toISOString()
        } : null;
        await database.query(
            `UPDATE ChatConversations
             SET assistantState = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE patientId = ?`,
            [persistedState ? JSON.stringify(persistedState) : null, patientId]
        );
    },

    clear: async (patientId) => {
        await database.query(
            `UPDATE ChatConversations
             SET assistantState = NULL, updatedAt = CURRENT_TIMESTAMP
             WHERE patientId = ?`,
            [patientId]
        );
    }
});

const createBookingDraft = (existingState) => ({
    serviceIds: [],
    appointmentDate: '',
    appointmentTime: '',
    appointmentTimeSource: '',
    timeWindow: null,
    dentistId: null,
    triageTopicId: '',
    triageDone: false,
    notes: '',
    ...(existingState?.draft || {})
});

const applyBookingEdit = (draft, editIntent) => {
    const nextDraft = { ...draft };
    if (editIntent === 'service') {
        nextDraft.serviceIds = [];
        nextDraft.triageTopicId = '';
        nextDraft.triageDone = false;
        nextDraft.notes = '';
    }
    if (editIntent === 'date') {
        nextDraft.appointmentDate = '';
        nextDraft.appointmentTime = '';
        nextDraft.appointmentTimeSource = '';
        nextDraft.timeWindow = null;
    }
    if (editIntent === 'dentist') {
        nextDraft.dentistId = null;
        nextDraft.appointmentTime = '';
        nextDraft.appointmentTimeSource = '';
        nextDraft.timeWindow = null;
    }
    if (editIntent === 'time') {
        nextDraft.appointmentTime = '';
        nextDraft.appointmentTimeSource = '';
        nextDraft.timeWindow = null;
    }
    return nextDraft;
};

const INTENT_CLARIFICATION_OPTIONS = [
    { id: 'booking', label: 'Đặt lịch khám', canonicalMessage: 'Tôi muốn đặt lịch khám' },
    { id: 'appointments', label: 'Xem lịch hẹn', canonicalMessage: 'Cho tôi xem lịch hẹn của tôi' },
    { id: 'invoices', label: 'Xem hóa đơn', canonicalMessage: 'Cho tôi xem hóa đơn của tôi' },
    { id: 'consultation', label: 'Tư vấn nha khoa', canonicalMessage: 'Tôi muốn tư vấn nha khoa' },
    { id: 'human', label: 'Gặp nhân viên', canonicalMessage: 'Tôi muốn gặp nhân viên hỗ trợ' }
];

const createIntentClarificationState = (originalMessage = '') => ({
    mode: 'intent_clarification',
    expectedEntity: 'intent',
    originalMessage: String(originalMessage || '').slice(0, 500),
    options: INTENT_CLARIFICATION_OPTIONS,
    updatedAt: new Date().toISOString()
});

const resolveIntentClarification = (state, message) => {
    if (state?.mode !== 'intent_clarification') return null;
    const raw = String(message || '').trim();
    const choiceMatch = raw.match(/^(?:số|so|chọn|chon)?\s*(\d{1,2})$/i);
    if (choiceMatch) return state.options?.[Number(choiceMatch[1]) - 1] || null;

    const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    return (state.options || []).find((option) => {
        const label = option.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
        return normalized.includes(option.id) || normalized.includes(label);
    }) || null;
};

const dialogueState = createDialogueStateManager();

module.exports = {
    applyBookingEdit,
    createBookingDraft,
    createIntentClarificationState,
    createDialogueStateManager,
    resolveIntentClarification,
    getConversationAssistantState: dialogueState.get,
    saveConversationAssistantState: dialogueState.save,
    clearConversationAssistantState: dialogueState.clear
};
