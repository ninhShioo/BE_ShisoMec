const pool = require('../config/database');

const activityLogController = {
    // Lấy danh sách lịch sử hoạt động (Chỉ Admin)
    getLogs: async (req, res, next) => {
        try {
            const limit = parseInt(req.query.limit) || 20; // Mặc định lấy 20 log gần nhất
            
            const query = `
                SELECT 
                    a.id, a.action, a.entity, a.entityId, a.createdAt, a.ipAddress,
                    u.fullName as userName, u.role as userRole
                FROM ActivityLogs a
                LEFT JOIN Users u ON a.userId = u.id
                ORDER BY a.createdAt DESC
                LIMIT ?
            `;
            
            const [logs] = await pool.query(query, [limit]);
            
            res.json({
                success: true,
                message: 'Lấy lịch sử hoạt động thành công.',
                data: logs
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = activityLogController;
