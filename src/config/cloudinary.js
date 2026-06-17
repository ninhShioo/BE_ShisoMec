const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const { getMissingCloudinaryEnv } = require('./env');

const missingCloudinaryEnv = getMissingCloudinaryEnv();
if (missingCloudinaryEnv.length > 0) {
    console.warn(`[cloudinary] Missing config: ${missingCloudinaryEnv.join(', ')}.`);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'dental_clinic',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'pdf'],
        transformation: [{ width: 800, height: 800, crop: 'limit' }]
    }
});

const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const uploadCloud = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 5
    },
    fileFilter: (req, file, cb) => {
        if (!allowedMimeTypes.includes(file.mimetype)) {
            return cb(new Error('Chỉ hỗ trợ upload JPG, PNG, WEBP hoặc PDF.'));
        }

        cb(null, true);
    }
});

module.exports = { cloudinary, uploadCloud };
