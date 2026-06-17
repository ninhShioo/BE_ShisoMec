const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Đăng ký tài khoản mới (thường là patient)
router.post('/register', authController.register);

// Đăng nhập
router.post('/login', authController.login);

// Lấy thông tin user hiện tại (cần verifyToken)
const { verifyToken } = require('../middlewares/auth.middleware');
router.get('/me', verifyToken, authController.getMe);

module.exports = router;
