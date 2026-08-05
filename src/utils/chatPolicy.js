const clampNumber = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

const getChatPolicyConfig = () => ({
    maxMessageLength: clampNumber(process.env.CHAT_MAX_MESSAGE_LENGTH, 1200, 100, 4000),
    rateLimitWindowMs: clampNumber(process.env.CHAT_RATE_LIMIT_WINDOW_MS, 10000, 1000, 60000),
    rateLimitMax: clampNumber(process.env.CHAT_RATE_LIMIT_MAX, 8, 2, 60),
    dedupeTtlMs: clampNumber(process.env.CHAT_DEDUPE_TTL_MS, 300000, 10000, 3600000),
    assistantStateTtlMs: clampNumber(process.env.CHAT_ASSISTANT_STATE_TTL_MINUTES, 30, 5, 1440) * 60 * 1000
});

const normalizeClientMessageId = (value) => {
    const id = String(value || '').trim();
    return /^[a-zA-Z0-9:_-]{8,100}$/.test(id) ? id : '';
};

const isAssistantStateExpired = (state, ttlMs, now = Date.now()) => {
    if (!state) return false;
    const updatedAt = Date.parse(state.updatedAt || '');
    if (!Number.isFinite(updatedAt)) return true;
    return now - updatedAt > ttlMs;
};

const publicBookingError = (error) => {
    const message = String(error?.message || '').trim();
    const allowedMessages = [
        /^Hệ thống đang bảo trì/,
        /^Phòng khám đang tạm ngưng đặt lịch online/,
        /^Bạn không thể đặt lịch cho tài khoản khác/,
        /^Vui lòng cung cấp ngày, giờ và ít nhất một dịch vụ/,
        /^Mỗi lịch hẹn chỉ được chọn tối đa/,
        /^Ngày hoặc giờ hẹn không hợp lệ/,
        /^Cần đặt lịch trước ít nhất/,
        /^Bệnh nhân không tồn tại hoặc đang bị khóa/,
        /^Bệnh nhân đã có lịch hẹn khác/,
        /^Bác sĩ không tồn tại hoặc đang bị khóa/,
        /^Danh sách dịch vụ không hợp lệ/,
        /^Bác sĩ đã có lịch hẹn khác/,
        /^Bác sĩ không làm việc/,
        /^Bác sĩ nghỉ/,
        /^Khung giờ khám nằm ngoài lịch làm việc/,
        /^Khung giờ phải theo bước/,
        /^Khung giờ khám bị trùng giờ nghỉ/
    ];

    if (allowedMessages.some((pattern) => pattern.test(message))) return message;
    return 'Hệ thống chưa thể tạo lịch ở thời điểm này. Bạn vui lòng chọn giờ khác hoặc gặp nhân viên hỗ trợ.';
};

class ChatMessageGuard {
    constructor(config = getChatPolicyConfig()) {
        this.config = config;
        this.rateBuckets = new Map();
        this.recentMessageIds = new Map();
    }

    check({ userId, message, clientMessageId, now = Date.now() }) {
        const content = String(message || '').trim();
        if (!content) {
            return { ok: false, code: 'empty', message: 'Tin nhắn không được để trống.' };
        }

        if (content.length > this.config.maxMessageLength) {
            return {
                ok: false,
                code: 'too_long',
                message: `Tin nhắn chỉ được tối đa ${this.config.maxMessageLength} ký tự.`
            };
        }

        const normalizedMessageId = normalizeClientMessageId(clientMessageId);
        const dedupeKey = normalizedMessageId ? `${userId}:${normalizedMessageId}` : '';
        this.prune(now);

        if (dedupeKey && this.recentMessageIds.has(dedupeKey)) {
            return { ok: false, code: 'duplicate', silent: true };
        }

        const bucket = (this.rateBuckets.get(userId) || [])
            .filter((timestamp) => now - timestamp < this.config.rateLimitWindowMs);
        if (bucket.length >= this.config.rateLimitMax) {
            this.rateBuckets.set(userId, bucket);
            return {
                ok: false,
                code: 'rate_limit',
                message: 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng chờ một chút rồi thử lại.'
            };
        }

        bucket.push(now);
        this.rateBuckets.set(userId, bucket);
        if (dedupeKey) this.recentMessageIds.set(dedupeKey, now);
        return { ok: true, message: content, clientMessageId: normalizedMessageId };
    }

    prune(now = Date.now()) {
        for (const [key, timestamp] of this.recentMessageIds.entries()) {
            if (now - timestamp >= this.config.dedupeTtlMs) this.recentMessageIds.delete(key);
        }

        for (const [userId, timestamps] of this.rateBuckets.entries()) {
            const activeTimestamps = timestamps.filter(
                (timestamp) => now - timestamp < this.config.rateLimitWindowMs
            );
            if (activeTimestamps.length > 0) this.rateBuckets.set(userId, activeTimestamps);
            else this.rateBuckets.delete(userId);
        }
    }
}

class KeyedTaskQueue {
    constructor() {
        this.tails = new Map();
    }

    run(key, task) {
        const previous = this.tails.get(key) || Promise.resolve();
        const current = previous.catch(() => undefined).then(task);
        const tail = current.catch(() => undefined).finally(() => {
            if (this.tails.get(key) === tail) this.tails.delete(key);
        });
        this.tails.set(key, tail);
        return current;
    }
}

module.exports = {
    ChatMessageGuard,
    KeyedTaskQueue,
    getChatPolicyConfig,
    isAssistantStateExpired,
    normalizeClientMessageId,
    publicBookingError
};
