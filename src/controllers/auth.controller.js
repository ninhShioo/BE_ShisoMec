const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const cleanText = (value) => String(value || '').trim();
const cleanOptionalText = (value, maxLength = 255) => {
    const text = cleanText(value);
    return text ? text.slice(0, maxLength) : null;
};

const isStrongPassword = (password) => (
    typeof password === 'string'
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
);

const publicUserFields = (user) => ({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    avatar: user.avatar,
    createdAt: user.createdAt
});

const isConfiguredGoogleClientId = (clientId) => (
    Boolean(clientId)
    && clientId.endsWith('.apps.googleusercontent.com')
    && !clientId.startsWith('xxxxx.')
    && !clientId.startsWith('your_')
);

const signToken = (user) => jwt.sign(
    {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const verifyGoogleIdToken = async (idToken) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!isConfiguredGoogleClientId(googleClientId)) {
        const error = new Error('Chưa cấu hình Google Client ID.');
        error.statusCode = 503;
        throw error;
    }

    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!response.ok) return null;

    const payload = await response.json();
    const isVerifiedEmail = payload.email_verified === true || payload.email_verified === 'true';
    const isExpectedClient = payload.aud === googleClientId;
    const isExpired = payload.exp && Number(payload.exp) * 1000 < Date.now();

    if (!isVerifiedEmail || !isExpectedClient || isExpired) return null;

    return {
        email: normalizeEmail(payload.email),
        fullName: cleanText(payload.name || payload.email),
        avatar: cleanOptionalText(payload.picture),
        googleId: cleanText(payload.sub)
    };
};

const authController = {
    register: async (req, res, next) => {
        try {
            const fullName = cleanText(req.body.fullName);
            const email = normalizeEmail(req.body.email);
            const password = String(req.body.password || '');
            const phone = cleanText(req.body.phone);

            if (!fullName || !email || !password) {
                return res.status(400).json({ success: false, message: 'Vui lòng nhập đủ họ tên, email và mật khẩu.' });
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ success: false, message: 'Email không hợp lệ.' });
            }

            if (!isStrongPassword(password)) {
                return res.status(400).json({
                    success: false,
                    message: 'Mật khẩu cần ít nhất 8 ký tự, có chữ hoa, chữ thường và số.'
                });
            }

            const [existingUsers] = await pool.query('SELECT id FROM Users WHERE email = ?', [email]);
            if (existingUsers.length > 0) {
                return res.status(409).json({ success: false, message: 'Email này đã được sử dụng.' });
            }

            const hashedPassword = await bcrypt.hash(password, 12);
            const [result] = await pool.query(
                'INSERT INTO Users (fullName, email, password, phone, role) VALUES (?, ?, ?, ?, "patient")',
                [fullName, email, hashedPassword, phone || null]
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

    login: async (req, res, next) => {
        try {
            const email = normalizeEmail(req.body.email);
            const password = String(req.body.password || '');

            if (!email || !password) {
                return res.status(400).json({ success: false, message: 'Vui lòng nhập email và mật khẩu.' });
            }

            const [users] = await pool.query('SELECT * FROM Users WHERE email = ? LIMIT 1', [email]);
            if (users.length === 0) {
                return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
            }

            const user = users[0];
            if (user.status !== 'active') {
                return res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị vô hiệu hóa.' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
            }

            res.json({
                success: true,
                message: 'Đăng nhập thành công.',
                token: signToken(user),
                user: publicUserFields(user)
            });
        } catch (error) {
            next(error);
        }
    },

    googleLogin: async (req, res, next) => {
        try {
            const idToken = String(req.body.idToken || req.body.credential || '').trim();
            if (!idToken) {
                return res.status(400).json({ success: false, message: 'Thiếu mã xác thực Google.' });
            }

            const googleUser = await verifyGoogleIdToken(idToken);
            if (!googleUser || !googleUser.email) {
                return res.status(401).json({ success: false, message: 'Không thể xác thực tài khoản Google.' });
            }

            let [users] = await pool.query('SELECT * FROM Users WHERE email = ? LIMIT 1', [googleUser.email]);
            let user = users[0];
            let isNewUser = false;

            if (!user) {
                const randomPassword = crypto.randomBytes(32).toString('hex');
                const hashedPassword = await bcrypt.hash(randomPassword, 12);
                const [result] = await pool.query(
                    'INSERT INTO Users (fullName, email, password, phone, role, avatar) VALUES (?, ?, ?, NULL, "patient", ?)',
                    [googleUser.fullName || googleUser.email, googleUser.email, hashedPassword, googleUser.avatar]
                );

                const [createdUsers] = await pool.query(
                    'SELECT id, fullName, email, phone, role, status, avatar, createdAt FROM Users WHERE id = ? LIMIT 1',
                    [result.insertId]
                );
                user = createdUsers[0];
                isNewUser = true;
            } else {
                if (user.status !== 'active') {
                    return res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị vô hiệu hóa.' });
                }

                if (!user.avatar && googleUser.avatar) {
                    await pool.query('UPDATE Users SET avatar = ? WHERE id = ?', [googleUser.avatar, user.id]);
                    user.avatar = googleUser.avatar;
                }
            }

            res.json({
                success: true,
                message: isNewUser ? 'Đăng ký bằng Google thành công.' : 'Đăng nhập bằng Google thành công.',
                token: signToken(user),
                user: publicUserFields(user),
                isNewUser
            });
        } catch (error) {
            next(error);
        }
    },

    getMe: async (req, res, next) => {
        try {
            const [users] = await pool.query(
                'SELECT id, fullName, email, phone, role, status, avatar, createdAt FROM Users WHERE id = ? LIMIT 1',
                [req.user.id]
            );

            if (users.length === 0) {
                return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });
            }

            res.json({ success: true, data: users[0] });
        } catch (error) {
            next(error);
        }
    },

    changePassword: async (req, res, next) => {
        try {
            const currentPassword = String(req.body.currentPassword || '');
            const newPassword = String(req.body.newPassword || '');

            if (!currentPassword || !newPassword) {
                return res.status(400).json({ success: false, message: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.' });
            }

            if (!isStrongPassword(newPassword)) {
                return res.status(400).json({
                    success: false,
                    message: 'Mật khẩu mới cần ít nhất 8 ký tự, có chữ hoa, chữ thường và số.'
                });
            }

            if (currentPassword === newPassword) {
                return res.status(400).json({ success: false, message: 'Mật khẩu mới không được trùng mật khẩu hiện tại.' });
            }

            const [users] = await pool.query('SELECT id, password FROM Users WHERE id = ? LIMIT 1', [req.user.id]);
            if (users.length === 0) {
                return res.status(404).json({ success: false, message: 'Người dùng không tồn tại.' });
            }

            const isMatch = await bcrypt.compare(currentPassword, users[0].password);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: 'Mật khẩu hiện tại không đúng.' });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 12);
            await pool.query(
                'UPDATE Users SET password = ?, passwordChangedAt = NOW() WHERE id = ?',
                [hashedPassword, req.user.id]
            );

            res.json({ success: true, message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại nếu cần.' });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = authController;
