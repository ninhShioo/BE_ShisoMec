const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/review.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.get('/public', reviewController.getApprovedReviews);

router.use(verifyToken);

router.get('/my', checkRole(['patient']), reviewController.getMyReviews);
router.post('/', checkRole(['patient']), logActivity('CREATE_REVIEW', 'Reviews'), reviewController.createReview);
router.get('/', checkRole(['admin']), reviewController.getAllReviews);
router.put('/:id/status', checkRole(['admin']), logActivity('UPDATE_REVIEW_STATUS', 'Reviews'), reviewController.updateReviewStatus);

module.exports = router;
