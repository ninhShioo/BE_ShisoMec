const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config({ quiet: true });

async function alterDatabase() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'dental_clinic_db',
        multipleStatements: true
    });

    try {
        console.log('Altering database tables...');
        
        // Thêm cột image vào Services nếu chưa có
        await connection.query(`
            ALTER TABLE Services 
            ADD COLUMN image VARCHAR(255) DEFAULT NULL;
        `).catch(err => {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
            console.log('Column image already exists in Services.');
        });

        // Thêm cột attachments vào MedicalRecords nếu chưa có
        await connection.query(`
            ALTER TABLE MedicalRecords 
            ADD COLUMN attachments TEXT COMMENT 'Lưu mảng JSON URL của X-Ray/PDF';
        `).catch(err => {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
            console.log('Column attachments already exists in MedicalRecords.');
        });

        // Thêm cột categoryId vào Services nếu chưa có
        await connection.query(`
            ALTER TABLE Services 
            ADD COLUMN categoryId INT DEFAULT NULL;
        `).catch(err => {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
            console.log('Column categoryId already exists in Services.');
        });

        await connection.query(`
            ALTER TABLE Services
            ADD CONSTRAINT fk_service_category FOREIGN KEY (categoryId) REFERENCES Categories(id) ON DELETE SET NULL;
        `).catch(err => {
            if (err.code !== 'ER_FK_DUP_NAME' && !err.message.includes('Duplicate key name')) throw err;
            console.log('Foreign key fk_service_category already exists.');
        });

        await connection.query(`
            ALTER TABLE Appointments
            ADD COLUMN preferredDentistId INT NULL AFTER patientId;
        `).catch(err => {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
            console.log('Column preferredDentistId already exists in Appointments.');
        });

        await connection.query(`
            UPDATE Appointments
            SET preferredDentistId = dentistId
            WHERE preferredDentistId IS NULL AND dentistId IS NOT NULL;
        `);

        await connection.query(`
            ALTER TABLE Appointments
            ADD INDEX idx_appointments_preferred_dentist (preferredDentistId, appointmentDate);
        `).catch(err => {
            if (err.code !== 'ER_DUP_KEYNAME') throw err;
            console.log('Index idx_appointments_preferred_dentist already exists.');
        });

        await connection.query(`
            ALTER TABLE Appointments
            ADD CONSTRAINT fk_appointments_preferred_dentist
            FOREIGN KEY (preferredDentistId) REFERENCES Users(id) ON DELETE SET NULL;
        `).catch(err => {
            if (err.code !== 'ER_FK_DUP_NAME' && !err.message.includes('Duplicate key name')) throw err;
            console.log('Foreign key fk_appointments_preferred_dentist already exists.');
        });

        await connection.query(`
            ALTER TABLE Promotions
            ADD COLUMN name VARCHAR(150) NOT NULL DEFAULT 'Khuyến mãi',
            ADD COLUMN description TEXT,
            ADD COLUMN isActive TINYINT(1) DEFAULT 1;
        `).catch(err => {
            if (err.code !== 'ER_DUP_FIELDNAME') throw err;
            console.log('Promotion compatibility columns already exist.');
        });

        await connection.query(`
            ALTER TABLE Promotions
            MODIFY code VARCHAR(50) NULL;
        `).catch(err => {
            if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
            console.log('Column code does not exist in Promotions.');
        });

        console.log('Database altered successfully.');
    } catch (err) {
        console.error('Error altering database:', err);
    } finally {
        await connection.end();
    }
}

alterDatabase();
