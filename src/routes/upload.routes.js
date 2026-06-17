const express = require('express');
const router = express.Router();
const { uploadCloud } = require('../config/cloudinary');
const uploadController = require('../controllers/upload.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');

router.use(verifyToken);

router.post('/single', uploadCloud.single('file'), uploadController.uploadSingle);
router.post('/multiple', checkRole(['dentist', 'admin', 'staff']), uploadCloud.array('files', 5), uploadController.uploadMultiple);

module.exports = router;
