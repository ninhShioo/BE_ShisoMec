const { normalizeText } = require('./chatIntent.service');

const DEFAULT_THRESHOLD = 0.48;
const STOP_WORDS = new Set([
    'ai', 'ban', 'biet', 'cai', 'can', 'cho', 'co', 'cua', 'duoc', 'gi', 'hoi',
    'khong', 'la', 'minh', 'mot', 'muon', 'nay', 'nhu', 'toi', 'tu', 'va', 've'
]);

const tokenize = (value) => [...new Set(
    normalizeText(value)
        .split(' ')
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
)];

const splitKeywords = (value) => {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
};

const tokenCoverage = (queryTokens, candidateTokens) => {
    if (!queryTokens.length || !candidateTokens.length) return 0;
    const matches = candidateTokens.filter((token) => queryTokens.includes(token)).length;
    return matches / candidateTokens.length;
};

const scoreKnowledgeItem = (query, item) => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return { score: 0, matchedSignals: [] };

    const queryTokens = tokenize(normalizedQuery);
    const title = normalizeText(item.title);
    const category = normalizeText(item.category);
    const keywords = splitKeywords(item.keywords);
    const matchedSignals = [];
    let score = 0;

    for (const keyword of keywords) {
        const normalizedKeyword = normalizeText(keyword);
        if (!normalizedKeyword) continue;

        if (normalizedQuery.includes(normalizedKeyword)) {
            const phraseScore = normalizedKeyword.split(' ').length > 1 ? 0.86 : 0.68;
            if (phraseScore > score) score = phraseScore;
            matchedSignals.push(`keyword:${keyword}`);
            continue;
        }

        const coverage = tokenCoverage(queryTokens, tokenize(normalizedKeyword));
        if (coverage >= 0.75) {
            score = Math.max(score, 0.56 + Math.min(coverage, 1) * 0.14);
            matchedSignals.push(`keyword_tokens:${keyword}`);
        }
    }

    const titleCoverage = tokenCoverage(queryTokens, tokenize(title));
    if (title && normalizedQuery.includes(title)) {
        score = Math.max(score, 0.9);
        matchedSignals.push('title_exact');
    } else if (titleCoverage >= 0.6) {
        score = Math.max(score, 0.45 + titleCoverage * 0.25);
        matchedSignals.push('title_tokens');
    }

    if (category && queryTokens.includes(category)) {
        score = Math.min(0.99, score + 0.06);
        matchedSignals.push('category');
    }

    return {
        score: Number(Math.min(score, 0.99).toFixed(3)),
        matchedSignals: [...new Set(matchedSignals)]
    };
};

const rankKnowledgeItems = (query, items = [], { threshold = DEFAULT_THRESHOLD, limit = 3 } = {}) => {
    const ranked = items.map((item) => ({
        ...item,
        ...scoreKnowledgeItem(query, item)
    }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

    const seenTitles = new Set();
    return ranked.filter((item) => {
        const key = normalizeText(item.title) || `${item.source || 'builtin'}:${item.id}`;
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
    }).slice(0, limit);
};

const toSourceMetadata = (item) => ({
    id: item.id,
    source: item.source || 'builtin',
    title: item.title || '',
    category: item.category || 'general',
    score: item.score,
    matchedSignals: item.matchedSignals || []
});

const createKnowledgeRetriever = ({ database, builtinItems = [], threshold = DEFAULT_THRESHOLD } = {}) => ({
    retrieve: async (query, { limit = 3 } = {}) => {
        let databaseItems = [];
        if (database?.query) {
            try {
                const [rows] = await database.query(
                    `SELECT id, title, category, keywords, answer, updatedAt
                     FROM AiKnowledge
                     WHERE isActive = 1
                     ORDER BY updatedAt DESC
                     LIMIT 200`
                );
                databaseItems = rows.map((row) => ({
                    ...row,
                    id: `db_${row.id}`,
                    source: 'database'
                }));
            } catch {
                databaseItems = [];
            }
        }

        const normalizedBuiltin = builtinItems.map((item) => ({
            ...item,
            source: item.source || 'builtin',
            category: item.category || 'general'
        }));
        const matches = rankKnowledgeItems(query, [...databaseItems, ...normalizedBuiltin], {
            threshold: Number.isFinite(Number(threshold)) && Number(threshold) >= 0 && Number(threshold) <= 1
                ? Number(threshold)
                : DEFAULT_THRESHOLD,
            limit
        });

        return {
            bestMatch: matches[0] || null,
            matches,
            confidence: matches[0]?.score || 0,
            sources: matches.map(toSourceMetadata)
        };
    }
});

module.exports = {
    DEFAULT_THRESHOLD,
    createKnowledgeRetriever,
    rankKnowledgeItems,
    scoreKnowledgeItem,
    splitKeywords,
    tokenize,
    toSourceMetadata
};
