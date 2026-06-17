const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ quiet: true });

const rootDir = path.join(__dirname, '..');
const workspaceDir = path.join(rootDir, '..');

const checks = [];

const addCheck = async (name, fn) => {
    try {
        await fn();
        checks.push({ name, ok: true });
    } catch (error) {
        checks.push({ name, ok: false, message: error.message });
    }
};

const requireFile = (relativePath) => {
    const filePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${relativePath}`);
    }
};

const requireWorkspaceFile = (relativePath) => {
    const filePath = path.join(workspaceDir, relativePath);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${relativePath}`);
    }
};

const requireEnv = (key) => {
    if (!process.env[key]) {
        throw new Error(`Missing ${key}`);
    }
};

const checkNodeVersion = () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) {
        throw new Error(`Node.js 18+ is required, current is ${process.version}`);
    }
};

const checkJwtSecret = () => {
    requireEnv('JWT_SECRET');
    if (process.env.JWT_SECRET.length < 32) {
        throw new Error('JWT_SECRET should be at least 32 characters.');
    }
};

const checkDatabase = async () => {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'dental_clinic_db',
        port: process.env.DB_PORT || 3306
    });

    try {
        await connection.query('SELECT 1');
    } finally {
        await connection.end();
    }
};

const main = async () => {
    await addCheck('Node.js version', checkNodeVersion);
    await addCheck('Root .env exists', () => requireFile('.env'));
    await addCheck('Root .env.example exists', () => requireFile('.env.example'));
    await addCheck('Frontend env example exists', () => requireWorkspaceFile('frontend/.env.example'));
    await addCheck('JWT secret is configured', checkJwtSecret);
    await addCheck('Database connection works', checkDatabase);
    await addCheck('Backend smoke test script exists', () => requireFile('scripts/smoke_api.js'));

    const failed = checks.filter((check) => !check.ok);

    checks.forEach((check) => {
        console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}${check.message ? ` - ${check.message}` : ''}`);
    });

    if (failed.length > 0) {
        process.exit(1);
    }
};

main();
