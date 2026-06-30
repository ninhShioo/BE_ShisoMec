const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.use(verifyToken);

router.get('/dentist/:dentistId', checkRole(['admin', 'staff', 'dentist']), scheduleController.getDentistSchedule);
router.put('/dentist/:dentistId', checkRole(['admin', 'staff']), logActivity('UPDATE_DOCTOR_SCHEDULE', 'DoctorSchedules'), scheduleController.updateDentistSchedule);
router.get('/days-off', checkRole(['admin', 'staff', 'dentist']), scheduleController.getDaysOff);
router.post('/days-off', checkRole(['admin', 'staff']), logActivity('CREATE_DOCTOR_DAY_OFF', 'DoctorDaysOff'), scheduleController.createDayOff);
router.delete('/days-off/:id', checkRole(['admin', 'staff']), logActivity('DELETE_DOCTOR_DAY_OFF', 'DoctorDaysOff'), scheduleController.deleteDayOff);
router.get('/day-off-requests', checkRole(['admin', 'staff', 'dentist']), scheduleController.getDayOffRequests);
router.post('/day-off-requests', checkRole(['dentist']), logActivity('CREATE_DAY_OFF_REQUEST', 'DoctorDayOffRequests'), scheduleController.createDayOffRequest);
router.put('/day-off-requests/:requestId', checkRole(['admin', 'staff']), logActivity('REVIEW_DAY_OFF_REQUEST', 'DoctorDayOffRequests'), scheduleController.reviewDayOffRequest);

module.exports = router;
