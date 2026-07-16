const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ quiet: true });

const { seedDemoData } = require('./seed_demo');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 3306
};

const databaseName = process.env.DB_NAME || 'dental_clinic_db';

const splitSqlStatements = (sql) => sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

const runSqlFile = async (connection, filePath) => {
    const sql = fs.readFileSync(filePath, 'utf8');
    const statements = splitSqlStatements(sql);

    for (const statement of statements) {
        await connection.query(statement);
    }
};

const addColumnIfMissing = async (connection, tableName, columnName, definition) => {
    const [columns] = await connection.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [databaseName, tableName, columnName]
    );

    if (columns.length === 0) {
        await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        console.log(`Added column ${tableName}.${columnName}`);
    }
};

const addIndexIfMissing = async (connection, tableName, indexName, definition) => {
    const [indexes] = await connection.query(
        `SELECT INDEX_NAME
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
         LIMIT 1`,
        [databaseName, tableName, indexName]
    );

    if (indexes.length === 0) {
        await connection.query(`ALTER TABLE ${tableName} ADD ${definition}`);
        console.log(`Added index ${tableName}.${indexName}`);
    }
};

const addForeignKeyIfMissing = async (connection, constraintName, sql) => {
    const [constraints] = await connection.query(
        `SELECT CONSTRAINT_NAME
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = ? AND CONSTRAINT_NAME = ?
         LIMIT 1`,
        [databaseName, constraintName]
    );

    if (constraints.length === 0) {
        await connection.query(sql);
        console.log(`Added foreign key ${constraintName}`);
    }
};

const seedAiKnowledge = async (connection) => {
    const [[countRow]] = await connection.query('SELECT COUNT(*) as count FROM AiKnowledge');
    if (Number(countRow?.count || 0) > 0) return;

    const items = [
        ['Đặt lịch qua AI', 'booking', 'muốn đặt lịch,đặt lịch giúp,đăng ký khám,hẹn bác sĩ,cần khám,khám răng', 'Mình có thể đặt lịch hộ bạn ngay trong chat. Mình sẽ hỏi dịch vụ hoặc triệu chứng, ngày khám, bác sĩ mong muốn và khung giờ phù hợp.'],
        ['Khám lần đầu', 'procedure', 'lần đầu đi khám,cần mang gì,chuẩn bị gì,đi khám lần đầu', 'Nếu khám lần đầu, bạn nên mang giấy tờ tùy thân, phim/chẩn đoán cũ nếu có, danh sách thuốc đang dùng và đến sớm vài phút để lễ tân check-in.'],
        ['Đến muộn', 'appointment', 'đến muộn,trễ giờ,quá giờ hẹn,tôi bị trễ', 'Nếu có thể đến muộn, bạn nên báo lễ tân qua hotline. Phòng khám sẽ kiểm tra khả năng giữ lịch hoặc hỗ trợ đổi sang khung giờ phù hợp.'],
        ['Chi phí điều trị', 'payment', 'giá bao nhiêu,chi phí,báo giá,có đắt không,tính tiền thế nào', 'Chi phí phụ thuộc tình trạng răng thực tế, dịch vụ cần làm và kế hoạch điều trị. Hệ thống có thể gợi ý giá dịch vụ, nhưng bác sĩ sẽ xác nhận sau khi thăm khám.'],
        ['Gặp nhân viên', 'support', 'gặp nhân viên,gặp lễ tân,cần người tư vấn,nói chuyện với người thật', 'Mình sẽ chuyển hội thoại sang nhóm cần nhân viên hỗ trợ để lễ tân/admin nhìn thấy và phản hồi cho bạn.']
    ];

    await connection.query(
        'INSERT INTO AiKnowledge (title, category, keywords, answer) VALUES ?',
        [items]
    );
    console.log('Seeded default AI knowledge');
};

const runCompatibilityMigrations = async (connection) => {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS DoctorSchedules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            dentistId INT NOT NULL,
            dayOfWeek TINYINT NOT NULL,
            startTime TIME NOT NULL DEFAULT '08:00:00',
            endTime TIME NOT NULL DEFAULT '17:00:00',
            breakStart TIME DEFAULT '12:00:00',
            breakEnd TIME DEFAULT '13:00:00',
            slotIntervalMinutes INT NOT NULL DEFAULT 30,
            isActive TINYINT(1) DEFAULT 1,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_doctor_schedule_day (dentistId, dayOfWeek),
            FOREIGN KEY (dentistId) REFERENCES Users(id) ON DELETE CASCADE
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS DoctorDaysOff (
            id INT AUTO_INCREMENT PRIMARY KEY,
            dentistId INT NOT NULL,
            offDate DATE NOT NULL,
            reason VARCHAR(255),
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_doctor_day_off (dentistId, offDate),
            FOREIGN KEY (dentistId) REFERENCES Users(id) ON DELETE CASCADE
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS DoctorDayOffRequests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            dentistId INT NOT NULL,
            offDate DATE NOT NULL,
            reason VARCHAR(255),
            status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
            reviewedBy INT,
            reviewNote TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewedAt TIMESTAMP NULL,
            FOREIGN KEY (dentistId) REFERENCES Users(id) ON DELETE CASCADE,
            FOREIGN KEY (reviewedBy) REFERENCES Users(id) ON DELETE SET NULL,
            UNIQUE KEY uq_day_off_request_pending (dentistId, offDate, status),
            INDEX idx_day_off_request_status (status, offDate)
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS DentistChangeRequests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            appointmentId INT NOT NULL,
            requestedBy INT NOT NULL,
            oldDentistId INT,
            newDentistId INT NOT NULL,
            status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
            adminId INT,
            note TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewedAt TIMESTAMP NULL,
            FOREIGN KEY (appointmentId) REFERENCES Appointments(id) ON DELETE CASCADE,
            FOREIGN KEY (requestedBy) REFERENCES Users(id) ON DELETE CASCADE,
            FOREIGN KEY (oldDentistId) REFERENCES Users(id) ON DELETE SET NULL,
            FOREIGN KEY (newDentistId) REFERENCES Users(id) ON DELETE CASCADE,
            FOREIGN KEY (adminId) REFERENCES Users(id) ON DELETE SET NULL,
            INDEX idx_dentist_change_status (status, createdAt)
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS AppointmentStatusHistory (
            id INT AUTO_INCREMENT PRIMARY KEY,
            appointmentId INT NOT NULL,
            oldStatus VARCHAR(50),
            newStatus VARCHAR(50) NOT NULL,
            changedBy INT,
            reason TEXT,
            note TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (appointmentId) REFERENCES Appointments(id) ON DELETE CASCADE,
            FOREIGN KEY (changedBy) REFERENCES Users(id) ON DELETE SET NULL,
            INDEX idx_appointment_status_history (appointmentId, createdAt)
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS InvoiceItems (
            id INT AUTO_INCREMENT PRIMARY KEY,
            invoiceId INT NOT NULL,
            serviceId INT,
            description VARCHAR(255) NOT NULL,
            quantity INT NOT NULL DEFAULT 1,
            unitPrice DECIMAL(10, 2) NOT NULL DEFAULT 0,
            totalPrice DECIMAL(10, 2) NOT NULL DEFAULT 0,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invoiceId) REFERENCES Invoices(id) ON DELETE CASCADE,
            FOREIGN KEY (serviceId) REFERENCES Services(id) ON DELETE SET NULL
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS ChatConversations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            patientId INT NOT NULL UNIQUE,
            assignedTo INT,
            status ENUM('new', 'open', 'closed') DEFAULT 'new',
            assistantState TEXT,
            closedAt TIMESTAMP NULL,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (patientId) REFERENCES Users(id) ON DELETE CASCADE,
            FOREIGN KEY (assignedTo) REFERENCES Users(id) ON DELETE SET NULL,
            INDEX idx_chat_conversations_status (status, updatedAt)
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS NotificationPreferences (
            userId INT PRIMARY KEY,
            appointment TINYINT(1) DEFAULT 1,
            payment TINYINT(1) DEFAULT 1,
            chat TINYINT(1) DEFAULT 1,
            systemNotice TINYINT(1) DEFAULT 1,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS AiKnowledge (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(150) NOT NULL,
            category VARCHAR(80) DEFAULT 'general',
            keywords TEXT,
            answer TEXT NOT NULL,
            isActive TINYINT(1) DEFAULT 1,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_ai_knowledge_active (isActive, category)
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS AiTrainingSamples (
            id INT AUTO_INCREMENT PRIMARY KEY,
            patientId INT NULL,
            userMessage TEXT NOT NULL,
            assistantReply TEXT,
            intent VARCHAR(80) DEFAULT 'general',
            reviewReason VARCHAR(255),
            status ENUM('pending', 'used', 'ignored') DEFAULT 'pending',
            knowledgeId INT NULL,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewedAt TIMESTAMP NULL,
            reviewedBy INT NULL,
            FOREIGN KEY (patientId) REFERENCES Users(id) ON DELETE SET NULL,
            FOREIGN KEY (knowledgeId) REFERENCES AiKnowledge(id) ON DELETE SET NULL,
            FOREIGN KEY (reviewedBy) REFERENCES Users(id) ON DELETE SET NULL,
            INDEX idx_ai_training_samples_status (status, createdAt)
        )
    `);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS AiFeedback (
            id INT AUTO_INCREMENT PRIMARY KEY,
            messageId INT NOT NULL,
            userId INT NOT NULL,
            rating ENUM('helpful', 'unhelpful') NOT NULL,
            comment TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_ai_feedback_message_user (messageId, userId),
            FOREIGN KEY (messageId) REFERENCES ChatMessages(id) ON DELETE CASCADE,
            FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
            INDEX idx_ai_feedback_rating (rating, createdAt)
        )
    `);
    await seedAiKnowledge(connection);

    await addColumnIfMissing(connection, 'Services', 'image', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfMissing(connection, 'Services', 'categoryId', 'INT DEFAULT NULL');
    await addColumnIfMissing(connection, 'MedicalRecords', 'attachments', 'TEXT');
    await addColumnIfMissing(connection, 'MedicalRecords', 'chiefComplaint', 'TEXT');
    await addColumnIfMissing(connection, 'MedicalRecords', 'treatmentPlan', 'TEXT');
    await addColumnIfMissing(connection, 'MedicalRecords', 'treatmentSessions', 'TEXT');
    await addColumnIfMissing(connection, 'MedicalRecords', 'procedures', 'TEXT');
    await addColumnIfMissing(connection, 'MedicalRecords', 'toothPositions', 'TEXT');
    await addColumnIfMissing(connection, 'MedicalRecords', 'nextAppointmentDate', 'DATE NULL');
    await addColumnIfMissing(connection, 'MedicalRecords', 'nextAppointmentNote', 'TEXT');
    await addColumnIfMissing(connection, 'MedicalRecords', 'nextAppointmentReminderSentAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'MedicalRecords', 'nextAppointmentEmailReminderSentAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'MedicalRecords', 'nextAppointmentZaloReminderSentAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'ChatMessages', 'readAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'ChatMessages', 'isAssistant', 'TINYINT(1) DEFAULT 0');
    await addColumnIfMissing(connection, 'ChatMessages', 'assistantName', 'VARCHAR(120) DEFAULT NULL');
    await addColumnIfMissing(connection, 'ChatMessages', 'metadata', 'TEXT');
    await addColumnIfMissing(connection, 'ChatConversations', 'needsStaff', 'TINYINT(1) DEFAULT 0');
    await addColumnIfMissing(connection, 'ChatConversations', 'priorityReason', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfMissing(connection, 'ChatConversations', 'assistantState', 'TEXT');
    await addColumnIfMissing(connection, 'Promotions', 'name', "VARCHAR(150) NOT NULL DEFAULT 'Khuyến mãi'");
    await addColumnIfMissing(connection, 'Promotions', 'description', 'TEXT');
    await addColumnIfMissing(connection, 'Promotions', 'isActive', 'TINYINT(1) DEFAULT 1');
    await addColumnIfMissing(connection, 'Appointments', 'confirmationReminderSentAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'appointmentReminderEmailSentAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'appointmentReminderZaloSentAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'statusChangedAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'checkedInAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'startedAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'completedAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'cancelledAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'noShowAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'cancellationReason', 'TEXT');
    await addColumnIfMissing(connection, 'Appointments', 'statusNote', 'TEXT');
    await addColumnIfMissing(connection, 'Appointments', 'rescheduledAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Appointments', 'rescheduleReason', 'TEXT');
    await addColumnIfMissing(connection, 'Invoices', 'subtotalAmount', 'DECIMAL(10, 2) NOT NULL DEFAULT 0');
    await addColumnIfMissing(connection, 'Invoices', 'discountAmount', 'DECIMAL(10, 2) NOT NULL DEFAULT 0');
    await addColumnIfMissing(connection, 'Invoices', 'promotionId', 'INT NULL');
    await addColumnIfMissing(connection, 'Invoices', 'promotionName', 'VARCHAR(150) DEFAULT NULL');
    await addColumnIfMissing(connection, 'Invoices', 'promotionDiscountPercent', 'DECIMAL(5, 2) DEFAULT 0');
    await addColumnIfMissing(connection, 'Invoices', 'paidAmount', 'DECIMAL(10, 2) NOT NULL DEFAULT 0');
    await addColumnIfMissing(connection, 'Invoices', 'note', 'TEXT');
    await addColumnIfMissing(connection, 'Invoices', 'cancelledReason', 'TEXT');
    await addColumnIfMissing(connection, 'Users', 'passwordChangedAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Users', 'googleLinkedAt', 'TIMESTAMP NULL');
    await addColumnIfMissing(connection, 'Users', 'zaloUserId', 'VARCHAR(80) DEFAULT NULL');

    await connection.query(`
        ALTER TABLE Appointments
        MODIFY status ENUM('pending', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show') DEFAULT 'pending'
    `);
    await connection.query(`
        ALTER TABLE Invoices
        MODIFY status ENUM('unpaid', 'partial', 'paid', 'cancelled') DEFAULT 'unpaid'
    `);
    await connection.query(`
        ALTER TABLE Notifications
        MODIFY type ENUM('system', 'appointment', 'payment', 'chat', 'leave') DEFAULT 'system'
    `);

    await addForeignKeyIfMissing(
        connection,
        'fk_service_category',
        'ALTER TABLE Services ADD CONSTRAINT fk_service_category FOREIGN KEY (categoryId) REFERENCES Categories(id) ON DELETE SET NULL'
    ).catch((error) => {
        console.warn(`Skipped fk_service_category: ${error.message}`);
    });

    await addIndexIfMissing(
        connection,
        'Appointments',
        'idx_appointments_patient_slot',
        'INDEX idx_appointments_patient_slot (patientId, appointmentDate, appointmentTime)'
    );
    await addIndexIfMissing(
        connection,
        'Appointments',
        'idx_appointments_dentist_slot',
        'INDEX idx_appointments_dentist_slot (dentistId, appointmentDate, appointmentTime)'
    );
    await addIndexIfMissing(
        connection,
        'Appointments',
        'idx_appointments_status_date',
        'INDEX idx_appointments_status_date (status, appointmentDate)'
    );
    await addIndexIfMissing(
        connection,
        'Promotions',
        'idx_promotions_active_dates',
        'INDEX idx_promotions_active_dates (isActive, startDate, endDate)'
    );

    await addIndexIfMissing(
        connection,
        'MedicalRecords',
        'uq_medical_records_appointment',
        'UNIQUE KEY uq_medical_records_appointment (appointmentId)'
    ).catch((error) => {
        console.warn(`Skipped unique MedicalRecords.appointmentId: ${error.message}`);
    });

    await addIndexIfMissing(
        connection,
        'Invoices',
        'uq_invoices_appointment',
        'UNIQUE KEY uq_invoices_appointment (appointmentId)'
    ).catch((error) => {
        console.warn(`Skipped unique Invoices.appointmentId: ${error.message}`);
    });

    await addIndexIfMissing(
        connection,
        'Reviews',
        'uq_reviews_appointment',
        'UNIQUE KEY uq_reviews_appointment (appointmentId)'
    ).catch((error) => {
        console.warn(`Skipped unique Reviews.appointmentId: ${error.message}`);
    });
};

async function initDatabase() {
    const connection = await mysql.createConnection(dbConfig);

    try {
        console.log('Connected to MySQL server.');
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await connection.query(`USE \`${databaseName}\``);

        const schemaPath = path.join(__dirname, '../models/schema.sql');
        await runSqlFile(connection, schemaPath);
        await runCompatibilityMigrations(connection);
        await seedDemoData(connection);

        console.log('Database schema and demo data are ready.');
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exitCode = 1;
    } finally {
        await connection.end();
    }
}

initDatabase();
