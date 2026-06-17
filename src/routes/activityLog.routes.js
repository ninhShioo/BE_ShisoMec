const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activityLog.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');

// Chỉ Admin mới được xem log
router.get('/', verifyToken, checkRole(['admin']), activityLogController.getLogs);

module.exports = router;
