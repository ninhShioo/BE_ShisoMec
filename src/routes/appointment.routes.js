const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.use(verifyToken);

router.get('/slots', checkRole(['patient', 'admin', 'staff']), appointmentController.getAvailableSlots);
router.get('/dentist-change-requests', checkRole(['admin']), appointmentController.getDentistChangeRequests);
router.put('/dentist-change-requests/:requestId', checkRole(['admin']), logActivity('REVIEW_DENTIST_CHANGE_REQUEST', 'DentistChangeRequests'), appointmentController.reviewDentistChangeRequest);
router.post('/', checkRole(['patient', 'admin', 'staff']), logActivity('CREATE_APPOINTMENT', 'Appointments'), appointmentController.createAppointment);
router.get('/', checkRole(['patient', 'dentist', 'admin', 'staff']), appointmentController.getAllAppointments);
router.put('/:id/status', checkRole(['patient', 'dentist', 'admin', 'staff']), logActivity('UPDATE_APPOINTMENT_STATUS', 'Appointments'), appointmentController.updateAppointmentStatus);
router.put('/:id/reschedule', checkRole(['patient', 'admin', 'staff']), logActivity('RESCHEDULE_APPOINTMENT', 'Appointments'), appointmentController.rescheduleAppointment);
router.put('/:id/assign', checkRole(['admin', 'staff']), logActivity('ASSIGN_DENTIST', 'Appointments'), appointmentController.assignDentist);

module.exports = router;
