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
                            needsStaff: Boolean(metadata?.needsStaff)
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
        return aiText || null;
    } finally {
        clearTimeout(timer);
    }
};

module.exports = {
    getAiConfig,
    generateAiReply
};
