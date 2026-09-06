const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.get('/public', settingsController.getPublicSettings);

router.use(verifyToken);

router.get('/', checkRole(['admin', 'staff', 'dentist']), settingsController.getSettings);
router.put('/', checkRole(['admin']), logActivity('UPDATE_SETTINGS', 'Settings'), settingsController.updateSettings);

module.exports = router;
