const pool = require('../config/database');
const { summarizeAiQuality } = require('../services/aiQuality.service');
const { buildKnowledgeQaReport } = require('../services/aiKnowledgeQa.service');

const parseKeywords = (keywords) => {
    if (Array.isArray(keywords)) {
        return keywords.map((item) => String(item).trim()).filter(Boolean).join(', ');
    }

    return String(keywords || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .join(', ');
};

const validatePayload = ({ title, answer, keywords }) => {
    if (!title || !String(title).trim()) return 'Tiêu đề kiến thức là bắt buộc.';
    if (!answer || !String(answer).trim()) return 'Câu trả lời training là bắt buộc.';
    if (!keywords || parseKeywords(keywords).length === 0) return 'Cần nhập ít nhất một từ khóa.';
    if (String(title).trim().length > 150) return 'Tiêu đề tối đa 150 ký tự.';
    return null;
};

const evaluateCandidate = async (candidate, excludeId = null) => {
    const params = [];
    let query = `SELECT id, title, category, keywords, answer, updatedAt
                 FROM AiKnowledge
                 WHERE isActive = 1`;
    if (Number.isInteger(Number(excludeId)) && Number(excludeId) > 0) {
        query += ' AND id <> ?';
        params.push(Number(excludeId));
    }
    query += ' ORDER BY updatedAt DESC LIMIT 200';

    const [existingItems] = await pool.query(query, params);
    return buildKnowledgeQaReport({
        candidate,
        existingItems,
        testQuestions: Array.isArray(candidate.testQuestions) ? candidate.testQuestions : []
    });
};

const rejectUnsafeCandidate = (res, qa) => {
    if (qa.ready) return false;
    res.status(400).json({
        success: false,
        message: 'Tri thức chưa đạt kiểm tra chất lượng.',
        data: { qa }
    });
    return true;
};

const aiKnowledgeController = {
    validateCandidate: async (req, res, next) => {
        try {
            const validationError = validatePayload(req.body);
            if (validationError) {
                return res.status(400).json({ success: false, message: validationError });
            }

            const qa = await evaluateCandidate(req.body, req.body.id);
            res.json({
                success: true,
                message: qa.ready ? 'Tri thức đạt kiểm tra chất lượng.' : 'Tri thức cần chỉnh sửa trước khi sử dụng.',
                data: qa
            });
        } catch (error) {
            next(error);
        }
    },

    getTrainingSamples: async (req, res, next) => {
        try {
            const { status = 'pending', q = '' } = req.query;
            const params = [];
            let query = `
                SELECT
                    s.id,
                    s.patientId,
                    s.userMessage,
                    s.assistantReply,
                    s.intent,
                    s.reviewReason,
                    s.status,
                    s.knowledgeId,
                    s.createdAt,
                    s.reviewedAt,
                    patient.fullName as patientName,
                    reviewer.fullName as reviewedByName
                FROM AiTrainingSamples s
                LEFT JOIN Users patient ON patient.id = s.patientId
                LEFT JOIN Users reviewer ON reviewer.id = s.reviewedBy
                WHERE 1=1
            `;

            if (['pending', 'used', 'ignored'].includes(status)) {
                query += ' AND s.status = ?';
                params.push(status);
            }

            if (q) {
                query += ' AND (s.userMessage LIKE ? OR s.assistantReply LIKE ? OR s.intent LIKE ? OR patient.fullName LIKE ?)';
                const keyword = `%${q}%`;
                params.push(keyword, keyword, keyword, keyword);
            }

            query += ' ORDER BY FIELD(s.status, "pending", "used", "ignored"), s.createdAt DESC LIMIT 100';
            const [samples] = await pool.query(query, params);

            res.json({
                success: true,
                message: 'Lấy danh sách câu hỏi cần training thành công.',
                data: samples
            });
        } catch (error) {
            next(error);
        }
    },

    getFeedbackSummary: async (req, res, next) => {
        try {
            const requestedDays = Number(req.query.days || 30);
            const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 365 ? requestedDays : 30;
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            const [messages] = await pool.query(
                `SELECT id, metadata, createdAt
                 FROM ChatMessages
                 WHERE isAssistant = 1 AND createdAt >= ?
                 ORDER BY createdAt DESC
                 LIMIT 5000`,
                [since]
            );
            const [feedback] = await pool.query(
                `SELECT messageId, rating, createdAt
                 FROM AiFeedback
                 WHERE createdAt >= ?
                 ORDER BY createdAt DESC
                 LIMIT 5000`,
                [since]
            );
            const quality = summarizeAiQuality({ messages, feedback, days });

            const [recentUnhelpful] = await pool.query(`
                SELECT
                    f.id,
                    f.messageId,
                    f.comment,
                    f.createdAt,
                    m.message as assistantReply,
                    m.metadata,
                    u.fullName as userName
                FROM AiFeedback f
                JOIN ChatMessages m ON m.id = f.messageId
                JOIN Users u ON u.id = f.userId
                WHERE f.rating = "unhelpful"
                ORDER BY f.createdAt DESC
                LIMIT 8
            `);

            res.json({
                success: true,
                message: 'Lấy thống kê phản hồi AI thành công.',
                data: {
                    total: quality.totalFeedback,
                    helpful: quality.helpful,
                    unhelpful: quality.unhelpful,
                    quality,
                    recentUnhelpful
                }
            });
        } catch (error) {
            next(error);
        }
    },

    getAll: async (req, res, next) => {
        try {
            const { status = 'all', q = '' } = req.query;
            const params = [];
            let query = 'SELECT * FROM AiKnowledge WHERE 1=1';

            if (status === 'active') {
                query += ' AND isActive = 1';
            } else if (status === 'inactive') {
                query += ' AND isActive = 0';
            }

            if (q) {
                query += ' AND (title LIKE ? OR category LIKE ? OR keywords LIKE ? OR answer LIKE ?)';
                const keyword = `%${q}%`;
                params.push(keyword, keyword, keyword, keyword);
            }

            query += ' ORDER BY isActive DESC, updatedAt DESC, id DESC';
            const [items] = await pool.query(query, params);

            res.json({
                success: true,
                message: 'Lấy kho tri thức AI thành công.',
                data: items
            });
        } catch (error) {
            next(error);
        }
    },

    create: async (req, res, next) => {
        try {
            const { title, category = 'general', keywords, answer, isActive = true } = req.body;
            const validationError = validatePayload({ title, keywords, answer });
            if (validationError) {
                return res.status(400).json({ success: false, message: validationError });
            }
            const qa = await evaluateCandidate(req.body);
            if (rejectUnsafeCandidate(res, qa)) return;

            const [result] = await pool.query(
                `INSERT INTO AiKnowledge (title, category, keywords, answer, isActive)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    String(title).trim(),
                    String(category || 'general').trim() || 'general',
                    parseKeywords(keywords),
                    String(answer).trim(),
                    isActive === false || Number(isActive) === 0 ? 0 : 1
                ]
            );

            res.status(201).json({
                success: true,
                message: 'Đã thêm tri thức AI.',
                data: { id: result.insertId }
            });
        } catch (error) {
            next(error);
        }
    },

    updateTrainingSample: async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            const { status = 'ignored' } = req.body;

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID mẫu training không hợp lệ.' });
            }

            if (!['pending', 'used', 'ignored'].includes(status)) {
                return res.status(400).json({ success: false, message: 'Trạng thái mẫu training không hợp lệ.' });
            }

            const [result] = await pool.query(
                `UPDATE AiTrainingSamples
                 SET status = ?, reviewedAt = IF(? = "pending", NULL, NOW()), reviewedBy = IF(? = "pending", NULL, ?)
                 WHERE id = ?`,
                [status, status, status, req.user.id, id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy mẫu training.' });
            }

            res.json({ success: true, message: 'Đã cập nhật mẫu training.' });
        } catch (error) {
            next(error);
        }
    },

    promoteTrainingSample: async (req, res, next) => {
        const connection = await pool.getConnection();

        try {
            const id = Number(req.params.id);
            const { title, category = 'general', keywords, answer, isActive = true } = req.body;

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID mẫu training không hợp lệ.' });
            }

            const validationError = validatePayload({ title, keywords, answer });
            if (validationError) {
                return res.status(400).json({ success: false, message: validationError });
            }

            const qa = await evaluateCandidate(req.body);
            if (rejectUnsafeCandidate(res, qa)) return;

            await connection.beginTransaction();

            const [samples] = await connection.query('SELECT id FROM AiTrainingSamples WHERE id = ? FOR UPDATE', [id]);
            if (samples.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy mẫu training.' });
            }

            const [result] = await connection.query(
                `INSERT INTO AiKnowledge (title, category, keywords, answer, isActive)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    String(title).trim(),
                    String(category || 'general').trim() || 'general',
                    parseKeywords(keywords),
                    String(answer).trim(),
                    isActive === false || Number(isActive) === 0 ? 0 : 1
                ]
            );

            await connection.query(
                `UPDATE AiTrainingSamples
                 SET status = "used", knowledgeId = ?, reviewedAt = NOW(), reviewedBy = ?
                 WHERE id = ?`,
                [result.insertId, req.user.id, id]
            );

            await connection.commit();

            res.status(201).json({
                success: true,
                message: 'Đã chuyển mẫu training thành tri thức AI.',
                data: { id: result.insertId }
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    update: async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            const { title, category = 'general', keywords, answer, isActive = true } = req.body;

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID tri thức không hợp lệ.' });
            }

            const validationError = validatePayload({ title, keywords, answer });
            if (validationError) {
                return res.status(400).json({ success: false, message: validationError });
            }
            const qa = await evaluateCandidate(req.body, id);
            if (rejectUnsafeCandidate(res, qa)) return;

            const [result] = await pool.query(
                `UPDATE AiKnowledge
                 SET title = ?, category = ?, keywords = ?, answer = ?, isActive = ?
                 WHERE id = ?`,
                [
                    String(title).trim(),
                    String(category || 'general').trim() || 'general',
                    parseKeywords(keywords),
                    String(answer).trim(),
                    isActive === false || Number(isActive) === 0 ? 0 : 1,
                    id
                ]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy tri thức AI.' });
            }

            res.json({ success: true, message: 'Đã cập nhật tri thức AI.' });
        } catch (error) {
            next(error);
        }
    },

    delete: async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID tri thức không hợp lệ.' });
            }

            const [result] = await pool.query('UPDATE AiKnowledge SET isActive = 0 WHERE id = ?', [id]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy tri thức AI.' });
            }

            res.json({ success: true, message: 'Đã tắt tri thức AI.' });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = aiKnowledgeController;
