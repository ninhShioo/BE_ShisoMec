const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

async function applySchema() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true
    });

    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('Applying schema...');
        await connection.query('USE dental_clinic_db;');
        await connection.query(sql);
        console.log('Schema applied successfully.');
        
    } catch (err) {
        console.error('Error applying schema:', err);
    } finally {
        await connection.end();
    }
}

applySchema();
