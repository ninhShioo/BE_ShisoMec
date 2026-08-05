const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasKeyword = (text, keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) return false;
    return new RegExp(`(^|\\s)${escapeRegExp(normalizedKeyword)}(\\s|$)`).test(normalizeText(text));
};

const hasAny = (text, keywords) => keywords.some((keyword) => hasKeyword(text, keyword));

const uniqueTokens = (text) => [...new Set(normalizeText(text).split(' ').filter((token) => token.length >= 3))];

const scoreKeywords = (text, keywords) => {
    const normalizedText = normalizeText(text);
    const textTokens = uniqueTokens(normalizedText);
    let bestScore = 0;

    keywords.forEach((keyword) => {
        const normalizedKeyword = normalizeText(keyword);
        if (!normalizedKeyword) return;

        if (normalizedText.includes(normalizedKeyword)) {
            bestScore = Math.max(bestScore, normalizedKeyword.split(' ').length >= 2 ? 6 : 3);
            return;
        }

        const rawKeywordTokens = normalizedKeyword.split(' ').filter(Boolean);
        const keywordTokens = uniqueTokens(normalizedKeyword);
        if (rawKeywordTokens.length > 1 && keywordTokens.length < 2) return;
        const matchedTokens = keywordTokens.filter((token) => textTokens.includes(token));
        if (keywordTokens.length > 0 && matchedTokens.length > 0) {
            bestScore = Math.max(
                bestScore,
                matchedTokens.length / keywordTokens.length >= 0.75 ? 3 : matchedTokens.length
            );
        }
    });

    return bestScore;
};

const collectMatchedKeywords = (text, keywords = []) => keywords
    .filter((keyword) => hasKeyword(text, keyword));

const buildIntentCandidate = (id, priority, signals = [], baseConfidence = 0.55) => {
    const matchedSignals = [...new Set(signals.filter(Boolean))];
    if (matchedSignals.length === 0) return null;

    return {
        id,
        priority,
        matchedSignals,
        confidence: Math.min(0.99, baseConfidence + Math.min(matchedSignals.length - 1, 3) * 0.1)
    };
};

const findBestByKeywords = (items, text, threshold = 2) => {
    const ranked = items
        .map((item) => ({ item, score: scoreKeywords(text, item.keywords || []) }))
        .filter((entry) => entry.score >= threshold)
        .sort((a, b) => b.score - a.score);

    return ranked[0]?.item || null;
};

const detectIntentMessage = ({ message, topic, operationTopics }) => {
    const text = normalizeText(message);
    const personal = detectPersonalIntent(text);
    const bookingSignals = collectMatchedKeywords(text, ['dat lich', 'dang ky lich', 'lich kham', 'hen kham', 'booking', 'muon kham']);
    const slotSignals = collectMatchedKeywords(text, ['trong', 'gan nhat', 'it nguoi', 'luc nao', 'thoi diem', 'gio nao', 'bac si nao', 'slot']);
    const procedureSignals = collectMatchedKeywords(text, ['quy trinh', 'den dau', 'phong nao', 'gap ai', 'map', 'duong di', 'dia chi', 'check in']);
    const serviceSignals = collectMatchedKeywords(text, ['dich vu', 'gia', 'chi phi', 'bao nhieu', 'tu van gia']);
    const paymentSignals = collectMatchedKeywords(text, operationTopics.payment || []);
    const rescheduleSignals = collectMatchedKeywords(text, operationTopics.reschedule || []);
    const profileSignals = collectMatchedKeywords(text, operationTopics.profile || []);
    const openingSignals = collectMatchedKeywords(text, operationTopics.opening || []);
    const doctorSignals = collectMatchedKeywords(text, operationTopics.doctor || []);
    const consultationSignals = collectMatchedKeywords(text, ['tu van nha khoa', 'tu van rang', 'hoi ve rang mieng']);
    const humanSignals = collectMatchedKeywords(text, [
        'gap nhan vien', 'gap le tan', 'can nguoi tu van', 'nhan vien ho tro',
        'tu van vien', 'goi lai', 'noi chuyen voi nguoi that', 'nguoi that ho tro'
    ]);
    const isGreeting = /^(xin chao|chao|alo|hello|hi|tu van|can tu van)/.test(text);
    const candidates = [
        buildIntentCandidate('emergency', 100, topic?.id === 'emergency' ? ['emergency_topic'] : [], 0.95),
        buildIntentCandidate('human_support', 95, humanSignals, 0.9),
        buildIntentCandidate('patient_overview', 92, personal.overview ? ['personal_overview'] : [], 0.88),
        buildIntentCandidate('patient_followups', 91, personal.followUp ? ['personal_follow_up'] : [], 0.88),
        buildIntentCandidate('patient_medical_records', 90, personal.record ? ['personal_record'] : [], 0.88),
        buildIntentCandidate('patient_appointments', 89, personal.appointment ? ['personal_appointment'] : [], 0.88),
        buildIntentCandidate('patient_invoices', 88, personal.invoice ? ['personal_invoice'] : [], 0.88),
        buildIntentCandidate('booking', 80, bookingSignals, 0.72),
        buildIntentCandidate('payment', 75, paymentSignals, 0.68),
        buildIntentCandidate('reschedule', 74, rescheduleSignals, 0.72),
        buildIntentCandidate('availability', 70, slotSignals, 0.66),
        buildIntentCandidate('service', 65, serviceSignals, 0.62),
        buildIntentCandidate('doctor', 64, doctorSignals, 0.65),
        buildIntentCandidate('opening_hours', 73, openingSignals, 0.68),
        buildIntentCandidate('procedure', 62, procedureSignals, 0.65),
        buildIntentCandidate('profile', 61, profileSignals, 0.62),
        buildIntentCandidate('consultation', 60, consultationSignals, 0.68),
        buildIntentCandidate(topic?.id || 'clinical', 60, topic ? [`topic:${topic.id}`] : [], 0.82),
        buildIntentCandidate('greeting', 20, isGreeting ? ['greeting'] : [], 0.9)
    ].filter(Boolean).sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);

    const primary = candidates[0] || {
        id: 'general',
        priority: 0,
        matchedSignals: [],
        confidence: text.length >= 8 ? 0.3 : 0.2
    };
    const timeWindow = parseRequestedTimeWindow(message);
    const exactTime = ['after', 'before', 'range'].includes(timeWindow?.source)
        ? ''
        : parseRequestedTime(message);

    return {
        text,
        topic,
        isClinical: Boolean(topic),
        isBooking: bookingSignals.length > 0,
        isSlot: slotSignals.length > 0,
        isProcedure: procedureSignals.length > 0,
        isService: serviceSignals.length > 0,
        isPayment: paymentSignals.length > 0,
        isReschedule: rescheduleSignals.length > 0,
        isProfile: profileSignals.length > 0,
        isOpening: openingSignals.length > 0,
        isDoctor: doctorSignals.length > 0,
        isGreeting,
        primaryIntent: primary.id,
        detectedIntents: candidates.map((candidate) => candidate.id),
        confidence: primary.confidence,
        matchedSignals: primary.matchedSignals,
        entities: {
            date: parseRequestedDate(message),
            time: exactTime,
            timeWindow
        }
    };
};

const formatDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const isExactDate = (date, year, month, day) => (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
);

const parseRequestedDate = (text, now = new Date()) => {
    const normalized = normalizeText(text);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (hasAny(normalized, ['ngay kia'])) {
        const next = new Date(today);
        next.setDate(today.getDate() + 2);
        return formatDateKey(next);
    }

    if (hasAny(normalized, ['ngay mai', 'mai'])) {
        const next = new Date(today);
        next.setDate(today.getDate() + 1);
        return formatDateKey(next);
    }

    if (hasAny(normalized, ['hom nay', 'today'])) return formatDateKey(today);

    const daysLaterMatch = normalized.match(/\b(\d{1,2})\s*ngay nua\b/);
    if (daysLaterMatch) {
        const offset = Number(daysLaterMatch[1]);
        if (offset > 0 && offset <= 90) {
            const next = new Date(today);
            next.setDate(today.getDate() + offset);
            return formatDateKey(next);
        }
    }

    const weekdayMap = [
        { day: 0, keywords: ['chu nhat', 'cn'] },
        { day: 1, keywords: ['thu hai', 'thu 2'] },
        { day: 2, keywords: ['thu ba', 'thu 3'] },
        { day: 3, keywords: ['thu tu', 'thu 4'] },
        { day: 4, keywords: ['thu nam', 'thu 5'] },
        { day: 5, keywords: ['thu sau', 'thu 6'] },
        { day: 6, keywords: ['thu bay', 'thu 7', 'cuoi tuan'] }
    ];
    const requestedWeekday = weekdayMap.find((entry) => hasAny(normalized, entry.keywords));
    if (requestedWeekday) {
        const next = new Date(today);
        const asksNextWeek = hasAny(normalized, ['tuan sau']);
        const asksThisWeek = hasAny(normalized, ['tuan nay']);

        if (asksNextWeek) {
            const daysUntilNextMonday = ((8 - today.getDay()) % 7) || 7;
            const offsetFromMonday = requestedWeekday.day === 0 ? 6 : requestedWeekday.day - 1;
            next.setDate(today.getDate() + daysUntilNextMonday + offsetFromMonday);
        } else {
            let offset = (requestedWeekday.day - today.getDay() + 7) % 7;
            if (offset === 0 || (asksThisWeek && offset === 0)) offset = 7;
            next.setDate(today.getDate() + offset);
        }
        return formatDateKey(next);
    }

    const isoMatch = String(text).match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        const value = new Date(year, month - 1, day);
        if (isExactDate(value, year, month, day)) return formatDateKey(value);
    }

    const dateMatch = String(text).match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
    if (dateMatch) {
        const day = Number(dateMatch[1]);
        const month = Number(dateMatch[2]);
        const year = Number(dateMatch[3] || now.getFullYear());
        const value = new Date(year, month - 1, day);
        if (isExactDate(value, year, month, day)) {
            if (!dateMatch[3] && value < today) value.setFullYear(value.getFullYear() + 1);
            return formatDateKey(value);
        }
    }

    return '';
};

const parseRequestedTime = (text) => {
    const raw = String(text || '').toLowerCase();
    const explicitMatch = raw.match(/\b([01]?\d|2[0-3])\s*(?::|h|giờ|gio)\s*([0-5]\d)?\b/);
    const bareHourMatch = raw.trim().match(/^([01]?\d|2[0-3])$/);
    const match = explicitMatch || bareHourMatch;
    if (!match) return '';

    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const parseRequestedTimeWindow = (text) => {
    const normalized = normalizeText(text);
    const rangeMatch = normalized.match(/\b(?:tu|khoang)\s*([01]?\d|2[0-3])\s*(?:h|gio)?\s*(?:den|toi|-)\s*([01]?\d|2[0-3])\s*(?:h|gio)?\b/);
    if (rangeMatch) {
        const startHour = Number(rangeMatch[1]);
        const endHour = Number(rangeMatch[2]);
        if (startHour < endHour) {
            return {
                label: `từ ${startHour}:00 đến ${endHour}:00`,
                startMinutes: startHour * 60,
                endMinutes: endHour * 60,
                source: 'range'
            };
        }
    }

    const afterMatch = normalized.match(/\b(?:sau|tu)\s*([01]?\d|2[0-3])\s*(?:h|gio)\b/);
    if (afterMatch) {
        const hour = Number(afterMatch[1]);
        return {
            label: `sau ${hour}:00`,
            startMinutes: hour * 60,
            endMinutes: 24 * 60 - 1,
            source: 'after'
        };
    }

    const beforeMatch = normalized.match(/\b(?:truoc|muon truoc)\s*([01]?\d|2[0-3])\s*(?:h|gio)\b/);
    if (beforeMatch) {
        const hour = Number(beforeMatch[1]);
        return {
            label: `trước ${hour}:00`,
            startMinutes: 0,
            endMinutes: hour * 60,
            source: 'before'
        };
    }

    const periods = [
        { keywords: ['buoi sang', 'sang som', 'sang'], label: 'buổi sáng', startMinutes: 7 * 60, endMinutes: 12 * 60 },
        { keywords: ['buoi trua', 'trua'], label: 'buổi trưa', startMinutes: 11 * 60, endMinutes: 14 * 60 },
        { keywords: ['buoi chieu', 'chieu'], label: 'buổi chiều', startMinutes: 13 * 60, endMinutes: 17 * 60 + 30 },
        { keywords: ['buoi toi', 'toi nay', 'toi mai'], label: 'buổi tối', startMinutes: 17 * 60, endMinutes: 21 * 60 }
    ];
    const period = periods.find((entry) => hasAny(normalized, entry.keywords));
    return period ? { ...period, source: 'period' } : null;
};

const shouldClarifyIntent = (intent, { isInBookingFlow = false, hasPersonalDataIntent = false } = {}) => (
    !isInBookingFlow
    && !hasPersonalDataIntent
    && intent?.primaryIntent === 'general'
    && Number(intent?.confidence || 0) < 0.55
    && !intent?.isGreeting
);

const getChoiceNumber = (message) => {
    const match = String(message || '').trim().match(/^(?:so|số|chon|chọn)?\s*(\d{1,2})$/i);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) && value > 0 ? value : null;
};

const pickNumberedChoice = (items, choiceNumber) => {
    if (!choiceNumber || !Array.isArray(items)) return null;
    return items[choiceNumber - 1] || null;
};

const isBookingStartIntent = (text, bookingKeywords = []) => hasAny(text, [
    'dat lich', 'dang ky lich', 'hen lich', 'muon kham', 'muon dat', 'dat ho',
    'dang ky kham', 'hen bac si', 'can kham', 'muon gap bac si', 'xep lich', 'kham rang'
]) || scoreKeywords(text, bookingKeywords) >= 2;

const isGenericConsultIntent = (text, topic = null) => {
    const normalized = normalizeText(text);
    return hasAny(normalized, ['tu van', 'can tu van', 'toi muon tu van', 'hoi tu van'])
        && !topic
        && !hasAny(normalized, ['dat lich', 'dang ky', 'hen lich', 'gia', 'chi phi', 'nieng', 'implant', 'rang su', 'tay trang']);
};

const isNewConsultationIntent = (text) => hasAny(text, [
    'tu van cai khac', 'hoi cai khac', 'doi van de', 'tu van lai', 'bat dau lai', 'van de khac'
]);

const isHumanSupportIntent = (text) => hasAny(text, [
    'gap nhan vien', 'gap le tan', 'can nguoi tu van', 'nhan vien ho tro',
    'tu van vien', 'goi lai', 'noi chuyen voi nguoi that', 'nguoi that ho tro'
]);

const isCancelBookingDraft = (text) => hasAny(text, [
    'huy dat lich', 'bo qua dat lich', 'khong dat nua', 'dung dat lich'
]);

const isBookingConfirmIntent = (text) => hasAny(text, [
    'xac nhan', 'dong y', 'ok', 'oke', 'dung roi', 'chot lich', 'dat lich nay', 'tao lich', 'dat di'
]);

const detectBookingEditIntent = (text) => {
    if (hasAny(text, ['doi dich vu', 'chon dich vu khac', 'sua dich vu', 'doi trieu chung'])) return 'service';
    if (hasAny(text, ['doi ngay', 'sua ngay', 'ngay khac', 'chon ngay khac'])) return 'date';
    if (hasAny(text, ['doi bac si', 'sua bac si', 'chon bac si khac'])) return 'dentist';
    if (hasAny(text, ['doi gio', 'sua gio', 'gio khac', 'chon gio khac', 'doi khung gio'])) return 'time';
    return '';
};

const detectInvoiceScope = (text) => {
    if (hasAny(text, ['da thanh toan', 'da tra tien', 'da thu tien', 'hoan tat thanh toan', 'thanh toan roi', 'da dong tien'])) return 'paid';
    if (hasAny(text, ['tat ca hoa don', 'danh sach hoa don', 'cac hoa don', 'lich su hoa don', 'hoa don gan day'])) return 'all';
    return 'open';
};

const detectAppointmentScope = (text) => {
    if (hasAny(text, ['lich da huy', 'lich bi huy', 'lich huy', 'da huy'])) return 'cancelled';
    if (hasAny(text, ['lich da kham', 'da kham', 'da hoan thanh', 'lich hoan thanh', 'kham xong'])) return 'completed';
    if (hasAny(text, ['lich cu', 'lich qua khu', 'lich truoc day', 'lich da qua'])) return 'past';
    if (hasAny(text, ['tat ca lich', 'tat ca cac lich', 'danh sach lich', 'cac lich kham', 'lich su lich hen', 'lich su dat lich', 'lich su kham'])) return 'all';
    return 'upcoming';
};

const detectPersonalIntent = (text) => ({
    appointment: hasAny(text, [
        'lich cua toi', 'lich cua minh', 'lich hen cua toi', 'lich hen cua minh',
        'lich kham cua toi', 'lich kham cua minh', 'cac lich kham cua toi',
        'tat ca cac lich kham cua toi', 'tat ca lich kham', 'danh sach lich kham',
        'lich sap toi', 'toi co lich', 'xem lich hen', 'kiem tra lich hen',
        'kiem tra lich kham', 'lich hom nay', 'lich da kham', 'lich da huy', 'lich bi huy'
    ]),
    invoice: hasAny(text, ['hoa don cua toi', 'hoa don cua minh', 'hoa don chua thanh toan', 'xem hoa don', 'toi con no', 'can thanh toan', 'chua thanh toan', 'da thanh toan', 'da tra tien', 'da thu tien', 'lich su hoa don']),
    record: hasAny(text, ['ho so kham', 'lich su kham', 'lan truoc toi kham gi', 'lan truoc kham gi', 'toi da kham gi', 'ket qua kham', 'chan doan cua toi', 'don thuoc cua toi', 'phac do dieu tri', 'bac si ghi gi']),
    followUp: hasAny(text, ['tai kham', 'lich tai kham', 'ngay tai kham', 'khi nao tai kham', 'hen tai kham', 'co lich tai kham khong']),
    overview: hasAny(text, ['tong quan cua toi', 'thong tin cua toi', 'tai khoan cua toi', 'toi co gi', 'kiem tra tai khoan']),
    human: isHumanSupportIntent(text)
});

module.exports = {
    detectAppointmentScope,
    detectBookingEditIntent,
    detectIntentMessage,
    detectInvoiceScope,
    detectPersonalIntent,
    findBestByKeywords,
    getChoiceNumber,
    hasAny,
    isBookingConfirmIntent,
    isBookingStartIntent,
    isCancelBookingDraft,
    isGenericConsultIntent,
    isHumanSupportIntent,
    isNewConsultationIntent,
    normalizeText,
    parseRequestedDate,
    parseRequestedTime,
    parseRequestedTimeWindow,
    pickNumberedChoice,
    scoreKeywords,
    shouldClarifyIntent
};
