const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/service.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

// Public routes (Ai cũng xem được danh sách và chi tiết)
router.get('/', serviceController.getAllServices);

// Thống kê dịch vụ (Admin)
router.get('/usage/stats', verifyToken, checkRole(['admin']), serviceController.getServiceUsage);
router.get('/manage/all', verifyToken, checkRole(['admin']), serviceController.getManageServices);

router.get('/:id', serviceController.getServiceById);

// Protected routes (Chỉ Admin được Thêm, Sửa, Xóa)
// Middleware verifyToken kiểm tra đăng nhập chưa
// Middleware checkRole kiểm tra role có phải admin không
router.post('/', verifyToken, checkRole(['admin']), logActivity('CREATE_SERVICE', 'Services'), serviceController.createService);
router.put('/:id', verifyToken, checkRole(['admin']), logActivity('UPDATE_SERVICE', 'Services'), serviceController.updateService);
router.delete('/:id', verifyToken, checkRole(['admin']), logActivity('DELETE_SERVICE', 'Services'), serviceController.deleteService);

module.exports = router;
