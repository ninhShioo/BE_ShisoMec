const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const { withDoctorDisplayAvatar } = require('../utils/mediaDefaults');

const managedRoles = ['admin', 'dentist', 'staff'];
const visibleUserRoles = ['patient', 'dentist', 'staff', 'admin'];
const staffVisibleRoles = ['patient', 'dentist'];
const dentistVisibleRoles = ['patient'];

const userController = {
    getPublicDentists: async (req, res, next) => {
        try {
            const [dentists] = await pool.query(
                `SELECT id, fullName, phone, avatar
                 FROM Users
                 WHERE role = ? AND status = ?
                 ORDER BY fullName ASC`,
                ['dentist', 'active']
            );

            res.json({
                success: true,
                message: 'Lấy danh sách bác sĩ thành công.',
                data: dentists.map(withDoctorDisplayAvatar)
            });
        } catch (error) {
            next(error);
        }
    },

    getAllUsers: async (req, res, next) => {
        try {
            const { role } = req.query;
            let query = 'SELECT id, fullName, email, phone, role, status, avatar, createdAt FROM Users';
            const queryParams = [];

            if (role && !visibleUserRoles.includes(role)) {
                return res.status(400).json({ success: false, message: 'Role lọc danh sách không hợp lệ.' });
            }

            if (req.user.role === 'dentist' && role && !dentistVisibleRoles.includes(role)) {
                return res.status(403).json({ success: false, message: 'Bác sĩ chỉ được xem danh sách bệnh nhân.' });
            }

            if (req.user.role === 'staff' && role && !staffVisibleRoles.includes(role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Nhân viên chỉ được xem danh sách bệnh nhân và bác sĩ.'
                });
            }

            if (role) {
                query += ' WHERE role = ?';
                queryParams.push(role);
            } else if (req.user.role === 'staff') {
                query += ' WHERE role IN (?)';
                queryParams.push(staffVisibleRoles);
            } else if (req.user.role === 'dentist') {
                query += ' WHERE role IN (?)';
                queryParams.push(dentistVisibleRoles);
            }

            query += ' ORDER BY createdAt DESC';

            const [users] = await pool.query(query, queryParams);
            const normalizedUsers = users.map((user) => (
                user.role === 'dentist' ? withDoctorDisplayAvatar(user) : user
            ));
            res.json({
                success: true,
                message: 'Lấy danh sách người dùng thành công.',
                data: normalizedUsers
            });
        } catch (error) {
            next(error);
        }
    },

    createStaff: async (req, res, next) => {
        try {
            const { fullName, email, password, phone, role, avatar } = req.body;

            if (!fullName || !email || !password || !role) {
                return res.status(400).json({
                    success: false,
                    message: 'Vui lòng điền đầy đủ họ tên, email, mật khẩu và role.'
                });
            }

            if (!managedRoles.includes(role)) {
                return res.status(400).json({
                    success: false,
                    message: 'Role không hợp lệ. Chỉ có thể tạo admin, dentist hoặc staff.'
                });
            }

            const [existingUsers] = await pool.query('SELECT id FROM Users WHERE email = ? LIMIT 1', [email]);
            if (existingUsers.length > 0) {
                return res.status(409).json({ success: false, message: 'Email này đã được sử dụng.' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            const [result] = await pool.query(
                'INSERT INTO Users (fullName, email, password, phone, role, avatar) VALUES (?, ?, ?, ?, ?, ?)',
                [String(fullName).trim(), email, hashedPassword, phone || null, role, avatar || null]
            );

            res.status(201).json({
                success: true,
                message: `Tạo tài khoản ${role} thành công.`,
                data: {
                    id: result.insertId,
                    fullName: String(fullName).trim(),
                    email,
                    role,
                    avatar: avatar || null
                }
            });
        } catch (error) {
            next(error);
        }
    },

    updateStatus: async (req, res, next) => {
        try {
            const targetUserId = Number(req.params.id);
            const { status } = req.body;

            if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
                return res.status(400).json({ success: false, message: 'ID người dùng không hợp lệ.' });
            }

            if (!['active', 'inactive'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Trạng thái không hợp lệ. Chỉ hỗ trợ active hoặc inactive.'
                });
            }

            if (req.user.id === targetUserId) {
                return res.status(403).json({ success: false, message: 'Không thể tự khóa tài khoản của chính mình.' });
            }

            const [existing] = await pool.query('SELECT id FROM Users WHERE id = ? LIMIT 1', [targetUserId]);
            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng.' });
            }

            await pool.query('UPDATE Users SET status = ? WHERE id = ?', [status, targetUserId]);

            res.json({
                success: true,
                message: `Đã cập nhật trạng thái tài khoản thành ${status}.`
            });
        } catch (error) {
            next(error);
        }
    },

    updateUser: async (req, res, next) => {
        try {
            const targetUserId = Number(req.params.id);
            const { fullName, phone, role, avatar } = req.body;

            if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
                return res.status(400).json({ success: false, message: 'ID người dùng không hợp lệ.' });
            }

            if (!fullName || !String(fullName).trim()) {
                return res.status(400).json({ success: false, message: 'Họ tên là bắt buộc.' });
            }

            if (req.user.role !== 'admin' && req.user.id !== targetUserId) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn chỉ có thể cập nhật hồ sơ của chính mình.'
                });
            }

            const [existing] = await pool.query('SELECT id FROM Users WHERE id = ? LIMIT 1', [targetUserId]);
            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng.' });
            }

            if (role && req.user.role !== 'admin') {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền đổi role.' });
            }

            if (role && !visibleUserRoles.includes(role)) {
                return res.status(400).json({ success: false, message: 'Role không hợp lệ.' });
            }

            let query = 'UPDATE Users SET fullName = ?, phone = ?, avatar = ?';
            const queryParams = [String(fullName).trim(), phone || null, avatar || null];

            if (role && req.user.role === 'admin') {
                query += ', role = ?';
                queryParams.push(role);
            }

            query += ' WHERE id = ?';
            queryParams.push(targetUserId);

            await pool.query(query, queryParams);

            res.json({
                success: true,
                message: 'Cập nhật thông tin thành công.'
            });
        } catch (error) {
            next(error);
        }
    },

    resetPassword: async (req, res, next) => {
        try {
            const targetUserId = Number(req.params.id);
            const defaultPassword = 'nhakhoapremium';

            if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
                return res.status(400).json({ success: false, message: 'ID người dùng không hợp lệ.' });
            }

            const [existing] = await pool.query('SELECT id FROM Users WHERE id = ? LIMIT 1', [targetUserId]);
            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng.' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(defaultPassword, salt);

            await pool.query('UPDATE Users SET password = ? WHERE id = ?', [hashedPassword, targetUserId]);

            res.json({
                success: true,
                message: `Đã reset mật khẩu về mặc định: ${defaultPassword}`
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = userController;
