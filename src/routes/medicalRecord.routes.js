const express = require('express');
const router = express.Router();
const medicalRecordController = require('../controllers/medicalRecord.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.use(verifyToken);

router.post('/', checkRole(['dentist', 'admin']), logActivity('CREATE_MEDICAL_RECORD', 'MedicalRecords'), medicalRecordController.createRecord);
router.get('/patient/:patientId', checkRole(['patient', 'dentist', 'admin', 'staff']), medicalRecordController.getRecordsByPatient);

module.exports = router;
