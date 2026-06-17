const pool = require('../config/database');

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
                    MAX(c.createdAt) as lastMessageAt,
                    SUBSTRING_INDEX(
                        GROUP_CONCAT(c.message ORDER BY c.createdAt DESC SEPARATOR '|||'),
                        '|||',
                        1
                    ) as lastMessage,
                    SUM(CASE WHEN c.senderId = u.id AND c.readAt IS NULL THEN 1 ELSE 0 END) as unreadCount
                FROM Users u
                JOIN ChatMessages c ON c.senderId = u.id OR c.receiverId = u.id
                WHERE u.role = "patient"
                GROUP BY u.id, u.fullName, u.email, u.phone
                ORDER BY lastMessageAt DESC
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

            if (req.user.role === 'admin' || req.user.role === 'staff') {
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
                 LIMIT 50`,
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
    }
};

module.exports = chatController;
