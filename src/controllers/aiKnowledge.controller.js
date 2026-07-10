const pool = require('../config/database');

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

const aiKnowledgeController = {
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
            const [[summary]] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN rating = "helpful" THEN 1 ELSE 0 END) as helpful,
                    SUM(CASE WHEN rating = "unhelpful" THEN 1 ELSE 0 END) as unhelpful
                FROM AiFeedback
                WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `);

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
                    total: Number(summary.total || 0),
                    helpful: Number(summary.helpful || 0),
                    unhelpful: Number(summary.unhelpful || 0),
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
