const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotion.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

// Public
router.get('/active', promotionController.getActivePromotions);

// Admin only
router.get('/', verifyToken, checkRole(['admin']), promotionController.getAllPromotions);
router.post('/', verifyToken, checkRole(['admin']), logActivity('CREATE_PROMOTION', 'Promotions'), promotionController.createPromotion);
router.put('/:id', verifyToken, checkRole(['admin']), logActivity('UPDATE_PROMOTION', 'Promotions'), promotionController.updatePromotion);
router.delete('/:id', verifyToken, checkRole(['admin']), logActivity('DELETE_PROMOTION', 'Promotions'), promotionController.deletePromotion);

module.exports = router;
