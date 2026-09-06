const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const pool = require('./src/config/database');
const {
    validateStartupEnv,
    getCorsOrigins,
    getBodyLimit,
    getRateLimitConfig
} = require('./src/config/env');
const { errorHandler, notFoundHandler } = require('./src/middlewares/error.middleware');

validateStartupEnv();

const app = express();
const corsOrigins = getCorsOrigins();
const rateLimitConfig = getRateLimitConfig();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
    origin: corsOrigins,
    credentials: true
}));

app.use('/api/', rateLimit({
    windowMs: rateLimitConfig.windowMs,
    max: rateLimitConfig.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Quá nhiều request từ IP này, vui lòng thử lại sau.' }
}));

app.use(express.json({ limit: getBodyLimit() }));
app.use(express.urlencoded({ extended: true, limit: getBodyLimit() }));

app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Dental Clinic API' });
});

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            success: true,
            status: 'ok',
            uptime: process.uptime(),
            database: 'ok',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            status: 'degraded',
            database: 'error',
            timestamp: new Date().toISOString()
        });
    }
});

const routes = require('./src/routes');
app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 8080;
const server = http.createServer(app);

const initSocket = require('./src/socket/index');
const io = initSocket(server);
const { startAppointmentReminderJob } = require('./src/jobs/appointmentReminder.job');
const reminderJob = startAppointmentReminderJob();

const shutdown = (signal) => {
    console.log(`${signal} received. Shutting down server...`);
    server.close(async () => {
        try {
            if (reminderJob) clearInterval(reminderJob);
            io.close();
            await pool.end();
            console.log('Server closed.');
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error.message);
            process.exit(1);
        }
    });

    setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, () => {
    console.log(`Server & Socket.io are running on port ${PORT}`);
});
