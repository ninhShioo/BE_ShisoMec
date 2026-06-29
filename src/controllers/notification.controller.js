const pool = require('../config/database');

const preferenceKeys = ['appointment', 'payment', 'chat', 'system'];
const preferenceColumnByKey = {
    appointment: 'appointment',
    payment: 'payment',
    chat: 'chat',
    system: 'systemNotice'
};

const toBool = (value) => value === true || value === 1 || value === '1' || value === 'true';

const normalizePreferences = (row = {}) => ({
    appointment: row.appointment === undefined ? true : Boolean(Number(row.appointment)),
    payment: row.payment === undefined ? true : Boolean(Number(row.payment)),
    chat: row.chat === undefined ? true : Boolean(Number(row.chat)),
    system: row.systemNotice === undefined ? true : Boolean(Number(row.systemNotice))
});

const ensurePreferences = async (connectionOrPool, userId) => {
    await connectionOrPool.query(
        `INSERT IGNORE INTO NotificationPreferences
         (userId, appointment, payment, chat, systemNotice)
         VALUES (?, 1, 1, 1, 1)`,
        [userId]
    );
};

const notificationController = {
    getMyNotifications: async (req, res, next) => {
        try {
            const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
            const unreadOnly = toBool(req.query.unreadOnly);

            let query = `
                SELECT id, title, message, type, isRead, createdAt
                FROM Notifications
                WHERE userId = ?
            `;
            const params = [req.user.id];

            if (unreadOnly) {
                query += ' AND isRead = 0';
            }

            query += ' ORDER BY createdAt DESC LIMIT ?';
            params.push(limit);

            const [rows] = await pool.query(query, params);

            res.json({ success: true, message: 'Lấy thông báo thành công.', data: rows });
        } catch (error) {
            next(error);
        }
    },

    getPreferences: async (req, res, next) => {
        try {
            await ensurePreferences(pool, req.user.id);
            const [rows] = await pool.query(
                'SELECT appointment, payment, chat, systemNotice, updatedAt FROM NotificationPreferences WHERE userId = ? LIMIT 1',
                [req.user.id]
            );

            res.json({
                success: true,
                message: 'Lấy cấu hình thông báo thành công.',
                data: normalizePreferences(rows[0])
            });
        } catch (error) {
            next(error);
        }
    },

    updatePreferences: async (req, res, next) => {
        try {
            await ensurePreferences(pool, req.user.id);

            const current = {};
            preferenceKeys.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
                    current[key] = toBool(req.body[key]);
                }
            });

            if (Object.keys(current).length === 0) {
                return res.status(400).json({ success: false, message: 'Không có cấu hình thông báo nào để cập nhật.' });
            }

            const keys = Object.keys(current);
            const setSql = keys.map((key) => `${preferenceColumnByKey[key]} = ?`).join(', ');
            const params = [...keys.map((key) => current[key] ? 1 : 0), req.user.id];

            await pool.query(
                `UPDATE NotificationPreferences SET ${setSql} WHERE userId = ?`,
                params
            );

            const [rows] = await pool.query(
                'SELECT appointment, payment, chat, systemNotice, updatedAt FROM NotificationPreferences WHERE userId = ? LIMIT 1',
                [req.user.id]
            );

            res.json({
                success: true,
                message: 'Đã cập nhật cấu hình thông báo.',
                data: normalizePreferences(rows[0])
            });
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

    markAsUnread: async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID thông báo không hợp lệ.' });
            }

            await pool.query(
                'UPDATE Notifications SET isRead = 0 WHERE id = ? AND userId = ?',
                [id, req.user.id]
            );

            res.json({ success: true, message: 'Đã đánh dấu chưa đọc.' });
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
    },

    deleteNotification: async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID thông báo không hợp lệ.' });
            }

            await pool.query('DELETE FROM Notifications WHERE id = ? AND userId = ?', [id, req.user.id]);
            res.json({ success: true, message: 'Đã xóa thông báo.' });
        } catch (error) {
            next(error);
        }
    }
};

notificationController.ensurePreferences = ensurePreferences;

module.exports = notificationController;
