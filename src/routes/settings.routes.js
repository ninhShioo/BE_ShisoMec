const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.use(verifyToken, checkRole(['admin']));

router.get('/', settingsController.getSettings);
router.put('/', logActivity('UPDATE_SETTINGS', 'Settings'), settingsController.updateSettings);

module.exports = router;
