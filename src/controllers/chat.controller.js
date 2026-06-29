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
                GROUP BY u.id, u.fullName, u.email, u.phone, conv.id, conv.status, conv.assignedTo, assignee.fullName
                ORDER BY
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
                `SELECT c.id, c.senderId, c.receiverId, c.message, c.readAt, c.createdAt, u.fullName as senderName, u.role
                 FROM ChatMessages c
                 JOIN Users u ON c.senderId = u.id
                 WHERE c.senderId = ? OR c.receiverId = ?
                 ORDER BY c.createdAt DESC
                 LIMIT 80`,
                [patientId, patientId]
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
                     closedAt = IF(? = "closed", NOW(), NULL)
                 WHERE patientId = ?`,
                [status || null, targetAssignee, status || null, patientId]
            );

            res.json({ success: true, message: 'Đã cập nhật hội thoại.' });
        } catch (error) {
            next(error);
        }
    }
};

chatController.ensureConversation = ensureConversation;

module.exports = chatController;
