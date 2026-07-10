const pool = require('../config/database');

const validConversationStatuses = ['new', 'open', 'closed'];

const ensureConversation = async (connectionOrPool, patientId, assignedTo = null) => {
    await connectionOrPool.query(
        `INSERT INTO ChatConversations (patientId, assignedTo, status)
         VALUES (?, ?, "new")
         ON DUPLICATE KEY UPDATE
            updatedAt = CURRENT_TIMESTAMP,
            status = IF(status = "closed", "open", status),
            assignedTo = COALESCE(assignedTo, VALUES(assignedTo))`,
        [patientId, assignedTo]
    );
};

const chatController = {
    getContacts: async (req, res, next) => {
        try {
            if (!['admin', 'staff'].includes(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Chỉ nhân viên được xem danh sách hội thoại.' });
            }

            const [contacts] = await pool.query(`
                SELECT
                    u.id,
                    u.fullName,
                    u.email,
                    u.phone,
                    conv.id as conversationId,
                    COALESCE(conv.status, "new") as conversationStatus,
                    COALESCE(conv.needsStaff, 0) as needsStaff,
                    conv.priorityReason,
                    conv.assignedTo,
                    assignee.fullName as assignedToName,
                    MAX(c.createdAt) as lastMessageAt,
                    SUBSTRING_INDEX(
                        GROUP_CONCAT(c.message ORDER BY c.createdAt DESC SEPARATOR '|||'),
                        '|||',
                        1
                    ) as lastMessage,
                    SUM(CASE WHEN c.senderId = u.id AND c.readAt IS NULL THEN 1 ELSE 0 END) as unreadCount
                FROM Users u
                JOIN ChatMessages c ON c.senderId = u.id OR c.receiverId = u.id
                LEFT JOIN ChatConversations conv ON conv.patientId = u.id
                LEFT JOIN Users assignee ON assignee.id = conv.assignedTo
                WHERE u.role = "patient"
                GROUP BY u.id, u.fullName, u.email, u.phone, conv.id, conv.status, conv.needsStaff, conv.priorityReason, conv.assignedTo, assignee.fullName
                ORDER BY
                    COALESCE(conv.needsStaff, 0) DESC,
                    CASE COALESCE(conv.status, "new")
                        WHEN "new" THEN 1
                        WHEN "open" THEN 2
                        ELSE 3
                    END,
                    lastMessageAt DESC
                LIMIT 100
            `);

            res.json({ success: true, message: 'Lấy danh sách hội thoại thành công.', data: contacts });
        } catch (error) {
            next(error);
        }
    },

    getChatHistory: async (req, res, next) => {
        try {
            const patientId = req.user.role === 'patient' ? req.user.id : Number(req.query.patientId);
            if (!Number.isInteger(patientId) || patientId <= 0) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn khách hàng.' });
            }

            if (!['patient', 'admin', 'staff'].includes(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền xem hội thoại này.' });
            }

            await ensureConversation(pool, patientId, ['admin', 'staff'].includes(req.user.role) ? req.user.id : null);

            if (req.user.role === 'admin' || req.user.role === 'staff') {
                await pool.query(
                    `UPDATE ChatConversations
                     SET status = IF(status = "new", "open", status),
                         assignedTo = COALESCE(assignedTo, ?)
                     WHERE patientId = ?`,
                    [req.user.id, patientId]
                );
                await pool.query(
                    'UPDATE ChatMessages SET readAt = NOW() WHERE senderId = ? AND receiverId IS NULL AND readAt IS NULL',
                    [patientId]
                );
            } else {
                await pool.query(
                    'UPDATE ChatMessages SET readAt = NOW() WHERE receiverId = ? AND readAt IS NULL',
                    [patientId]
                );
            }

            const [messages] = await pool.query(
                `SELECT
                    c.id,
                    c.senderId,
                    c.receiverId,
                    c.message,
                    c.readAt,
                    c.createdAt,
                    c.isAssistant,
                    c.metadata,
                    fb.rating as aiFeedback,
                    IF(c.isAssistant = 1, COALESCE(c.assistantName, 'Trợ lý Phenikaa Dental'), u.fullName) as senderName,
                    IF(c.isAssistant = 1, 'assistant', u.role) as role
                 FROM ChatMessages c
                 JOIN Users u ON c.senderId = u.id
                 LEFT JOIN AiFeedback fb ON fb.messageId = c.id AND fb.userId = ?
                 WHERE c.senderId = ? OR c.receiverId = ?
                 ORDER BY c.createdAt DESC
                 LIMIT 80`,
                [req.user.id, patientId, patientId]
            );

            res.json({
                success: true,
                message: 'Lấy lịch sử chat thành công.',
                data: messages.reverse()
            });
        } catch (error) {
            next(error);
        }
    },

    submitMessageFeedback: async (req, res, next) => {
        const connection = await pool.getConnection();

        try {
            const messageId = Number(req.params.id);
            const rating = String(req.body.rating || '').trim();
            const comment = String(req.body.comment || '').trim().slice(0, 500) || null;

            if (!Number.isInteger(messageId) || messageId <= 0) {
                return res.status(400).json({ success: false, message: 'ID tin nhắn không hợp lệ.' });
            }

            if (!['helpful', 'unhelpful'].includes(rating)) {
                return res.status(400).json({ success: false, message: 'Đánh giá AI không hợp lệ.' });
            }

            const [messages] = await connection.query(
                `SELECT id, receiverId, message, metadata, createdAt
                 FROM ChatMessages
                 WHERE id = ? AND isAssistant = 1
                 LIMIT 1`,
                [messageId]
            );

            if (messages.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy câu trả lời AI.' });
            }

            const assistantMessage = messages[0];
            if (req.user.role === 'patient' && assistantMessage.receiverId !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Bạn chỉ được đánh giá câu trả lời trong hội thoại của mình.' });
            }

            await connection.beginTransaction();

            await connection.query(
                `INSERT INTO AiFeedback (messageId, userId, rating, comment)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), updatedAt = NOW()`,
                [messageId, req.user.id, rating, comment]
            );

            if (rating === 'unhelpful') {
                const patientId = assistantMessage.receiverId || req.user.id;
                const [previousMessages] = await connection.query(
                    `SELECT message
                     FROM ChatMessages
                     WHERE senderId = ?
                       AND isAssistant = 0
                       AND createdAt <= ?
                     ORDER BY createdAt DESC
                     LIMIT 1`,
                    [patientId, assistantMessage.createdAt]
                );

                const previousQuestion = previousMessages[0]?.message;
                if (previousQuestion) {
                    let metadata = {};
                    try {
                        metadata = JSON.parse(assistantMessage.metadata || '{}');
                    } catch {
                        metadata = {};
                    }

                    const [recentSamples] = await connection.query(
                        `SELECT id
                         FROM AiTrainingSamples
                         WHERE patientId = ?
                           AND userMessage = ?
                           AND status = "pending"
                           AND createdAt >= DATE_SUB(NOW(), INTERVAL 1 DAY)
                         LIMIT 1`,
                        [patientId, previousQuestion]
                    );

                    if (recentSamples.length === 0) {
                        await connection.query(
                            `INSERT INTO AiTrainingSamples
                             (patientId, userMessage, assistantReply, intent, reviewReason)
                             VALUES (?, ?, ?, ?, ?)`,
                            [
                                patientId,
                                previousQuestion,
                                assistantMessage.message,
                                metadata.intent || 'general',
                                'Khách đánh giá câu trả lời AI là chưa ổn.'
                            ]
                        );
                    }
                }
            }

            await connection.commit();

            res.json({
                success: true,
                message: rating === 'helpful' ? 'Cảm ơn bạn đã đánh giá câu trả lời.' : 'Đã ghi nhận để cải thiện AI.',
                data: { messageId, rating }
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    updateConversation: async (req, res, next) => {
        try {
            if (!['admin', 'staff'].includes(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền cập nhật hội thoại.' });
            }

            const patientId = Number(req.params.patientId);
            const { status, assignedTo } = req.body;

            if (!Number.isInteger(patientId) || patientId <= 0) {
                return res.status(400).json({ success: false, message: 'ID khách hàng không hợp lệ.' });
            }

            if (status !== undefined && !validConversationStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: 'Trạng thái hội thoại không hợp lệ.' });
            }

            const targetAssignee = assignedTo === undefined || assignedTo === null || assignedTo === ''
                ? req.user.id
                : Number(assignedTo);

            if (!Number.isInteger(targetAssignee) || targetAssignee <= 0) {
                return res.status(400).json({ success: false, message: 'Nhân viên phụ trách không hợp lệ.' });
            }

            await ensureConversation(pool, patientId, targetAssignee);
            await pool.query(
                `UPDATE ChatConversations
                 SET status = COALESCE(?, status),
                     assignedTo = ?,
                     needsStaff = IF(? = "closed", 0, needsStaff),
                     priorityReason = IF(? = "closed", NULL, priorityReason),
                     closedAt = IF(? = "closed", NOW(), NULL)
                 WHERE patientId = ?`,
                [status || null, targetAssignee, status || null, status || null, status || null, patientId]
            );

            res.json({ success: true, message: 'Đã cập nhật hội thoại.' });
        } catch (error) {
            next(error);
        }
    }
};

chatController.ensureConversation = ensureConversation;

module.exports = chatController;
