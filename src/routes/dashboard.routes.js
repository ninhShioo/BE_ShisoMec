const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');

router.get('/workspace', verifyToken, checkRole(['admin', 'staff', 'dentist']), dashboardController.getWorkspaceSummary);
router.get('/summary', verifyToken, checkRole(['admin']), dashboardController.getSummary);

module.exports = router;
