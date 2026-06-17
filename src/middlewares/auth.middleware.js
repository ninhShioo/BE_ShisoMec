const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const normalizeRoles = (roles) => (Array.isArray(roles) ? roles : [roles]);

const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Vui lòng đăng nhập để truy cập chức năng này.'
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [users] = await pool.query(
            'SELECT id, fullName, email, role, status FROM Users WHERE id = ? LIMIT 1',
            [decoded.id]
        );
        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Tài khoản không còn tồn tại. Vui lòng đăng nhập lại.'
            });
        }

        const user = users[0];
        if (user.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Tài khoản của bạn đã bị vô hiệu hóa.'
            });
        }

        req.user = {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            role: user.role
        };
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'
        });
    }
};

const checkRole = (roles) => {
    const allowedRoles = normalizeRoles(roles);

    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền truy cập chức năng này.'
            });
        }

        next();
    };
};

module.exports = {
    verifyToken,
    checkRole
};
