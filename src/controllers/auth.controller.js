const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const authController = {
    // Đăng ký tài khoản (Mặc định Role là patient)
    register: async (req, res, next) => {
        try {
            const { fullName, email, password, phone } = req.body;

            // Kiểm tra các trường bắt buộc
            if (!fullName || !email || !password) {
                return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ họ tên, email và mật khẩu.' });
            }

            // Kiểm tra email đã tồn tại chưa
            const [existingUsers] = await pool.query('SELECT id FROM Users WHERE email = ?', [email]);
            if (existingUsers.length > 0) {
                return res.status(409).json({ success: false, message: 'Email này đã được sử dụng.' });
            }

            // Mã hóa mật khẩu
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // Thêm người dùng vào database
            const [result] = await pool.query(
                'INSERT INTO Users (fullName, email, password, phone, role) VALUES (?, ?, ?, ?, ?)',
                [fullName, email, hashedPassword, phone, 'patient']
            );

            res.status(201).json({
                success: true,
                message: 'Đăng ký tài khoản thành công.',
                data: {
                    id: result.insertId,
                    fullName,
                    email,
                    role: 'patient'
                }
            });

        } catch (error) {
            next(error);
        }
    },

    // Đăng nhập
    login: async (req, res, next) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ success: false, message: 'Vui lòng nhập email và mật khẩu.' });
            }

            // Tìm user theo email
            const [users] = await pool.query('SELECT * FROM Users WHERE email = ?', [email]);
            if (users.length === 0) {
                return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
            }

            const user = users[0];

            // Kiểm tra trạng thái tài khoản
            if (user.status !== 'active') {
                return res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị vô hiệu hóa.' });
            }

            // So sánh mật khẩu
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
            }

            // Tạo JWT Token
            const payload = {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                role: user.role
            };

            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

            // Ẩn mật khẩu trước khi trả về
            delete user.password;

            res.json({
                success: true,
                message: 'Đăng nhập thành công.',
                token,
                user
            });

        } catch (error) {
            next(error);
        }
    },

    // Lấy thông tin user hiện tại từ Token
    getMe: async (req, res, next) => {
        try {
            const userId = req.user.id;
            const [users] = await pool.query('SELECT id, fullName, email, phone, role, avatar FROM Users WHERE id = ?', [userId]);
            if (users.length === 0) {
                return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });
            }
            res.json({ success: true, data: users[0] });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = authController;
