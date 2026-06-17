const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');

// Định tuyến đến các module
const serviceRoutes = require('./service.routes');
const userRoutes = require('./user.routes');
const appointmentRoutes = require('./appointment.routes');
const invoiceRoutes = require('./invoice.routes');
const chatRoutes = require('./chat.routes');
const recordRoutes = require('./medicalRecord.routes');
const activityLogRoutes = require('./activityLog.routes');
const uploadRoutes = require('./upload.routes');
const categoryRoutes = require('./category.routes');
const promotionRoutes = require('./promotion.routes');
const dashboardRoutes = require('./dashboard.routes');
const settingsRoutes = require('./settings.routes');
const scheduleRoutes = require('./schedule.routes');
const reviewRoutes = require('./review.routes');
const notificationRoutes = require('./notification.routes');

// Đăng ký các routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/services', serviceRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/chat', chatRoutes);
router.use('/records', recordRoutes);
router.use('/activity-logs', activityLogRoutes);
router.use('/upload', uploadRoutes);
router.use('/categories', categoryRoutes);
router.use('/promotions', promotionRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/settings', settingsRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);

module.exports = router;
