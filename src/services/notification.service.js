const pool = require('../config/database');
const { emitToUser, emitToRoles } = require('../socket/emitter');

const shouldSendNotification = async (db, userId, type) => {
    const key = ['appointment', 'payment', 'chat'].includes(type) ? type : 'systemNotice';
    const [rows] = await db.query(
        `SELECT ${key} as enabled FROM NotificationPreferences WHERE userId = ? LIMIT 1`,
        [userId]
    );

    if (rows.length === 0) return true;
    return Number(rows[0].enabled) === 1;
};

const createNotification = async (connectionOrPool, userId, title, message, type = 'system') => {
    const db = connectionOrPool || pool;
    if (!(await shouldSendNotification(db, userId, type))) {
        return null;
    }

    const [result] = await db.query(
        'INSERT INTO Notifications (userId, title, message, type) VALUES (?, ?, ?, ?)',
        [userId, title, message, type]
    );

    const notification = {
        id: result.insertId,
        userId,
        title,
        message,
        type,
        isRead: 0,
        createdAt: new Date()
    };

    emitToUser(userId, 'notification:new', notification);
    return notification;
};

const createNotificationsForRoles = async (connectionOrPool, roles, title, message, type = 'system') => {
    const db = connectionOrPool || pool;
    const [users] = await db.query(
        'SELECT id FROM Users WHERE role IN (?) AND status = "active"',
        [roles]
    );

    for (const user of users) {
        await createNotification(db, user.id, title, message, type);
    }

    emitToRoles(roles, 'notification:role', { title, message, type, createdAt: new Date() });
    return users.length;
};

module.exports = {
    createNotification,
    createNotificationsForRoles
};
