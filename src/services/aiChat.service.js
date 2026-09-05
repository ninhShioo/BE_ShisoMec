const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 12000;

const isEnabledValue = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());

const getAiConfig = () => {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
    const enabled = isEnabledValue(process.env.AI_CHAT_ENABLED) && Boolean(apiKey);
    const baseUrl = (process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

    return {
        enabled,
        apiKey,
        baseUrl,
        chatUrl: process.env.OPENAI_CHAT_URL || process.env.AI_CHAT_URL || `${baseUrl}/chat/completions`,
        model: process.env.OPENAI_MODEL || process.env.AI_MODEL || DEFAULT_MODEL,
        timeoutMs: Number(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
    };
};

const buildSystemPrompt = (settings = {}) => (
    [
        'Bạn là trợ lý AI của phòng khám nha khoa Phenikaa Dental.',
        'Nhiệm vụ: trả lời ngắn gọn, đúng trọng tâm, thân thiện và ưu tiên hành động tiếp theo cho khách.',
        'Ngữ điệu: nói như lễ tân nha khoa chuyên nghiệp, ấm áp, dễ hiểu; dùng "mình" khi hỗ trợ, tránh máy móc và tránh hù dọa khách.',
        'Chỉ sử dụng thông tin trong dữ liệu hệ thống và bản nháp trả lời được cung cấp. Không tự bịa bác sĩ, giá, slot, địa chỉ hoặc chính sách.',
        'Không chẩn đoán bệnh chính thức, không kê đơn, không thay bác sĩ. Với triệu chứng nặng như sưng mặt, sốt, đau dữ dội, khó thở, chảy máu không cầm: hướng dẫn gọi hotline ngay.',
        'Nếu khách hỏi đặt lịch: chỉ hướng dẫn chọn dịch vụ, bác sĩ, ngày giờ và gửi yêu cầu. Chỉ nói hướng dẫn đến phòng khám sau khi lịch đã đặt/xác nhận hoặc khi khách hỏi rõ quy trình đến khám.',
        'Nếu khách muốn gặp nhân viên: xác nhận đã chuyển lễ tân/nhân viên hỗ trợ.',
        `Hotline hiện tại: ${settings.phone || '0869 800 318'}.`,
        `Giờ làm việc: ${settings.openingHours || '08:00 - 20:00'}.`,
        'Trả lời bằng tiếng Việt. Tối đa 6 dòng trừ khi đang liệt kê slot hoặc quy trình.'
    ].join('\n')
);

const parseAssistantText = (payload) => {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();

    const outputText = payload?.output_text;
    if (typeof outputText === 'string' && outputText.trim()) return outputText.trim();

    return '';
};

const canonicalFact = (value) => String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,](?=\d)/g, '');

const extractGroundedFacts = (value) => {
    const text = String(value || '');
    const patterns = {
        url: /https?:\/\/[^\s)]+/giu,
        money: /\d[\d.,]*\s*(?:đ|vnd|đồng)(?=$|\s|[.,;!?])/giu,
        time: /\b(?:[01]?\d|2[0-3])(?::[0-5]\d|\s*h(?:\s*[0-5]\d)?)\b/giu,
        phone: /\b\d{8,11}\b/g,
        entityId: /#\d+\b/g
    };

    return Object.entries(patterns).flatMap(([type, pattern]) => (
        [...text.matchAll(pattern)].map((match) => ({
            type,
            value: match[0],
            canonical: canonicalFact(match[0])
        }))
    ));
};

const findUnsupportedFacts = (reply, allowedText) => {
    const allowedFacts = new Set(extractGroundedFacts(allowedText).map((fact) => `${fact.type}:${fact.canonical}`));
    return extractGroundedFacts(reply).filter((fact) => !allowedFacts.has(`${fact.type}:${fact.canonical}`));
};

const validateGroundedReply = ({ reply, draftReply, settings = {}, metadata = {} }) => {
    if (!reply || !String(reply).trim()) return { valid: false, unsupportedFacts: [] };
    const allowedText = JSON.stringify({ draftReply, settings, groundingSources: metadata.groundingSources || [] });
    const unsupportedFacts = findUnsupportedFacts(reply, allowedText);
    return {
        valid: unsupportedFacts.length === 0,
        unsupportedFacts
    };
};

const generateAiReply = async ({ userMessage, draftReply, settings, metadata }) => {
    const config = getAiConfig();
    if (!config.enabled) return null;

    if (typeof fetch !== 'function') {
        throw new Error('Runtime hiện tại chưa hỗ trợ fetch để gọi AI API.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
        const response = await fetch(config.chatUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.model,
                temperature: 0.25,
                max_tokens: 700,
                messages: [
                    { role: 'system', content: buildSystemPrompt(settings) },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            question: userMessage,
                            draftAnswer: draftReply,
                            clinic: {
                                name: settings.clinicName,
                                phone: settings.phone,
                                address: settings.address,
                                openingHours: settings.openingHours,
                                mapUrl: settings.mapUrl
                            },
                            intent: metadata?.intent || 'general',
                            needsStaff: Boolean(metadata?.needsStaff),
                            groundingSources: metadata?.groundingSources || []
                        })
                    }
                ]
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`AI API lỗi ${response.status}: ${errorText.slice(0, 180)}`);
        }

        const payload = await response.json();
        const aiText = parseAssistantText(payload);
        if (!aiText) return null;

        const validation = validateGroundedReply({
            reply: aiText,
            draftReply,
            settings,
            metadata
        });
        return validation.valid ? aiText : null;
    } finally {
        clearTimeout(timer);
    }
};

module.exports = {
    extractGroundedFacts,
    findUnsupportedFacts,
    getAiConfig,
    generateAiReply,
    validateGroundedReply
};
