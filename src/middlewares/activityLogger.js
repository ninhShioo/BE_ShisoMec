const pool = require('../config/database');

const sanitizeDetails = (body) => {
    if (!body || typeof body !== 'object') return {};

    const details = { ...body };
    delete details.password;
    delete details.confirmPassword;
    delete details.token;
    return details;
};

const logActivity = (action, entity) => {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const userId = req.user ? req.user.id : null;
                let entityId = req.params.id || null;

                if (!entityId && data && data.data && data.data.id) {
                    entityId = data.data.id;
                }

                if (userId) {
                    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                    const details = JSON.stringify(sanitizeDetails(req.body));

                    pool.query(
                        'INSERT INTO ActivityLogs (userId, action, entity, entityId, details, ipAddress) VALUES (?, ?, ?, ?, ?, ?)',
                        [userId, action, entity, entityId, details, ipAddress]
                    ).catch((err) => console.error('Lỗi khi ghi ActivityLog:', err.message));
                }
            }

            return originalJson.call(this, data);
        };

        next();
    };
};

module.exports = logActivity;
