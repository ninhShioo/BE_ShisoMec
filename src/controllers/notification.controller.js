const pool = require('../config/database');

const notificationController = {
    getMyNotifications: async (req, res, next) => {
        try {
            const [rows] = await pool.query(
                `SELECT id, title, message, type, isRead, createdAt
                 FROM Notifications
                 WHERE userId = ?
                 ORDER BY createdAt DESC
                 LIMIT 50`,
                [req.user.id]
            );

            res.json({ success: true, message: 'Lấy thông báo thành công.', data: rows });
        } catch (error) {
            next(error);
        }
    },

    markAsRead: async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID thông báo không hợp lệ.' });
            }

            await pool.query(
                'UPDATE Notifications SET isRead = 1 WHERE id = ? AND userId = ?',
                [id, req.user.id]
            );

            res.json({ success: true, message: 'Đã đánh dấu đã đọc.' });
        } catch (error) {
            next(error);
        }
    },

    markAllAsRead: async (req, res, next) => {
        try {
            await pool.query('UPDATE Notifications SET isRead = 1 WHERE userId = ?', [req.user.id]);
            res.json({ success: true, message: 'Đã đánh dấu tất cả thông báo đã đọc.' });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = notificationController;
