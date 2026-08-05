const { normalizeText } = require('./chatIntent.service');
const {
    DEFAULT_THRESHOLD,
    rankKnowledgeItems,
    splitKeywords,
    tokenize
} = require('./chatKnowledge.service');

const unique = (items) => [...new Set(items.filter(Boolean))];

const buildKnowledgeQaReport = ({ candidate = {}, existingItems = [], testQuestions = [] } = {}) => {
    const title = String(candidate.title || '').trim();
    const answer = String(candidate.answer || '').trim();
    const keywords = unique(splitKeywords(candidate.keywords));
    const normalizedTitle = normalizeText(title);
    const errors = [];
    const warnings = [];

    const searchableKeywords = keywords.filter((keyword) => tokenize(keyword).length > 0);
    if (!normalizedTitle) errors.push('Tiêu đề tri thức không hợp lệ.');
    if (answer.length < 30) errors.push('Câu trả lời cần ít nhất 30 ký tự để đủ ngữ cảnh.');
    if (searchableKeywords.length === 0) errors.push('Cần ít nhất một từ khóa có ý nghĩa để chatbot tìm kiếm.');

    if (answer.length >= 30 && answer.length < 80) warnings.push('Câu trả lời khá ngắn, nên bổ sung điều kiện hoặc hướng dẫn cụ thể hơn.');
    if (searchableKeywords.length === 1) warnings.push('Chỉ có một từ khóa có ý nghĩa, chatbot có thể bỏ sót cách hỏi khác.');

    const normalizedKeywords = searchableKeywords.map(normalizeText);
    const conflicts = [];
    existingItems.forEach((item) => {
        const itemTitle = normalizeText(item.title);
        const itemKeywords = splitKeywords(item.keywords).map(normalizeText);
        const sharedKeywords = normalizedKeywords.filter((keyword) => itemKeywords.includes(keyword));

        if (itemTitle && itemTitle === normalizedTitle) {
            errors.push(`Tiêu đề đang trùng với tri thức #${item.id}: ${item.title}.`);
        }
        if (sharedKeywords.length > 0) {
            conflicts.push({
                id: item.id,
                title: item.title,
                sharedKeywords
            });
        }
    });

    if (conflicts.length > 0) {
        warnings.push(`Có ${conflicts.length} tri thức đang dùng chung từ khóa; cần kiểm tra để tránh trả lời nhầm.`);
    }

    const explicitQuestions = unique(testQuestions.map((question) => String(question || '').trim()));
    const questions = unique([
        ...explicitQuestions,
        title,
        ...searchableKeywords.slice(0, 3)
    ]).slice(0, 6);
    const candidateItem = {
        ...candidate,
        id: 'candidate',
        title,
        answer,
        keywords,
        source: 'candidate'
    };
    const preview = questions.map((question) => {
        const matches = rankKnowledgeItems(question, [candidateItem, ...existingItems], {
            threshold: 0.2,
            limit: 5
        });
        const candidateRank = matches.findIndex((item) => item.id === 'candidate');
        const candidateMatch = candidateRank >= 0 ? matches[candidateRank] : null;

        return {
            question,
            candidateRank: candidateRank >= 0 ? candidateRank + 1 : null,
            candidateScore: candidateMatch?.score || 0,
            passesThreshold: Number(candidateMatch?.score || 0) >= DEFAULT_THRESHOLD,
            topMatches: matches.slice(0, 3).map((item) => ({
                id: item.id,
                title: item.title,
                score: item.score,
                source: item.source || 'database'
            }))
        };
    });

    const failedExplicitQuestions = preview
        .slice(0, explicitQuestions.length)
        .filter((item) => !item.passesThreshold);
    failedExplicitQuestions.forEach((item) => {
        errors.push(`Không đạt ngưỡng với câu hỏi kiểm tra: "${item.question}".`);
    });

    if (explicitQuestions.length === 0 && preview.length > 0 && preview.every((item) => !item.passesThreshold)) {
        errors.push('Ứng viên chưa đạt ngưỡng khớp với các câu hỏi kiểm tra.');
    } else if (preview.some((item) => item.candidateRank && item.candidateRank > 1)) {
        warnings.push('Một số câu hỏi đang ưu tiên tri thức khác cao hơn ứng viên mới.');
    }

    const dedupedErrors = unique(errors);
    const dedupedWarnings = unique(warnings);
    const readinessScore = Math.max(0, 100 - dedupedErrors.length * 30 - dedupedWarnings.length * 8);

    return {
        ready: dedupedErrors.length === 0,
        readinessScore,
        errors: dedupedErrors,
        warnings: dedupedWarnings,
        conflicts,
        preview
    };
};

module.exports = {
    buildKnowledgeQaReport
};
