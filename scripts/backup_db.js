const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ quiet: true });

const backupDir = path.join(__dirname, '../backups');
const database = process.env.DB_NAME || 'dental_clinic_db';
const host = process.env.DB_HOST || 'localhost';
const port = process.env.DB_PORT || '3306';
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(backupDir, `${database}-${timestamp}.sql`);

fs.mkdirSync(backupDir, { recursive: true });

const args = [
    `--host=${host}`,
    `--port=${port}`,
    `--user=${user}`,
    '--single-transaction',
    '--routines',
    '--triggers',
    database
];

const env = { ...process.env };
if (password) env.MYSQL_PWD = password;

const dump = spawn('mysqldump', args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
});

const output = fs.createWriteStream(outputPath);
dump.stdout.pipe(output);

let stderr = '';
dump.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
});

dump.on('error', (error) => {
    console.error(`Cannot start mysqldump: ${error.message}`);
    console.error('Make sure MySQL client tools are installed and mysqldump is available in PATH.');
    process.exit(1);
});

dump.on('close', (code) => {
    output.end();
    if (code !== 0) {
        console.error(`Backup failed with exit code ${code}.`);
        if (stderr) console.error(stderr.trim());
        process.exit(code || 1);
    }

    console.log(`Database backup created: ${outputPath}`);
});
