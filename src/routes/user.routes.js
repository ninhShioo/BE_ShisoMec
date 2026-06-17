const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.get('/public/dentists', userController.getPublicDentists);

router.use(verifyToken);

router.get('/', checkRole(['admin', 'staff', 'dentist']), userController.getAllUsers);
router.post('/staff', checkRole(['admin']), logActivity('CREATE_USER', 'Users'), userController.createStaff);
router.put('/:id/status', checkRole(['admin']), logActivity('UPDATE_USER_STATUS', 'Users'), userController.updateStatus);
router.put('/:id/reset-password', checkRole(['admin']), logActivity('RESET_USER_PASSWORD', 'Users'), userController.resetPassword);
router.put('/:id', logActivity('UPDATE_USER', 'Users'), userController.updateUser);

module.exports = router;
