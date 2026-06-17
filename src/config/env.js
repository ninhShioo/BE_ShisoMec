require('dotenv').config({ quiet: true });

const requiredEnv = ['JWT_SECRET'];
const dbEnv = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const cloudinaryEnv = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
];

const missing = (keys) => keys.filter((key) => !process.env[key]);

const getCorsOrigins = () => {
    const rawOrigins = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173';

    if (rawOrigins === '*') {
        return true;
    }

    return rawOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
};

const getBodyLimit = () => process.env.BODY_LIMIT || '1mb';

const getRateLimitConfig = () => ({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.RATE_LIMIT_MAX || 500)
});

const validateStartupEnv = () => {
    const missingRequired = missing(requiredEnv);
    if (missingRequired.length > 0) {
        console.error(`[env] Missing required environment variables: ${missingRequired.join(', ')}`);
        console.error('[env] Please copy .env.example to .env and fill the missing values.');
        process.exit(1);
    }

    const missingDb = missing(dbEnv);
    if (missingDb.length > 0) {
        console.warn(`[env] Missing DB variables (${missingDb.join(', ')}). Falling back to local defaults where available.`);
    }

    const missingCloudinary = missing(cloudinaryEnv);
    if (missingCloudinary.length > 0) {
        console.warn(`[env] Missing Cloudinary variables (${missingCloudinary.join(', ')}). File upload APIs will not work until configured.`);
    }
};

module.exports = {
    validateStartupEnv,
    getMissingCloudinaryEnv: () => missing(cloudinaryEnv),
    getCorsOrigins,
    getBodyLimit,
    getRateLimitConfig
};
