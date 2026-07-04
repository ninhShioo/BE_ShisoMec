CREATE TABLE IF NOT EXISTS Users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fullName VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    role ENUM('patient', 'staff', 'dentist', 'admin') DEFAULT 'patient',
    status ENUM('active', 'inactive') DEFAULT 'active',
    avatar VARCHAR(255),
    passwordChangedAt TIMESTAMP NULL,
    googleLinkedAt TIMESTAMP NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS DoctorDaysOff (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dentistId INT NOT NULL,
    offDate DATE NOT NULL,
    reason VARCHAR(255),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_doctor_day_off (dentistId, offDate),
    FOREIGN KEY (dentistId) REFERENCES Users(id) ON DELETE CASCADE
);

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
);

CREATE TABLE IF NOT EXISTS Services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    duration INT COMMENT 'Estimated duration in minutes',
    image VARCHAR(255) DEFAULT NULL,
    categoryId INT DEFAULT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_service_category FOREIGN KEY (categoryId) REFERENCES Categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patientId INT NOT NULL,
    dentistId INT,
    appointmentDate DATE NOT NULL,
    appointmentTime TIME NOT NULL,
    status ENUM('pending', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show') DEFAULT 'pending',
    notes TEXT,
    confirmationReminderSentAt TIMESTAMP NULL,
    appointmentReminderEmailSentAt TIMESTAMP NULL,
    statusChangedAt TIMESTAMP NULL,
    checkedInAt TIMESTAMP NULL,
    startedAt TIMESTAMP NULL,
    completedAt TIMESTAMP NULL,
    cancelledAt TIMESTAMP NULL,
    noShowAt TIMESTAMP NULL,
    cancellationReason TEXT,
    statusNote TEXT,
    rescheduledAt TIMESTAMP NULL,
    rescheduleReason TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (dentistId) REFERENCES Users(id) ON DELETE SET NULL,
    INDEX idx_appointments_patient_slot (patientId, appointmentDate, appointmentTime),
    INDEX idx_appointments_dentist_slot (dentistId, appointmentDate, appointmentTime),
    INDEX idx_appointments_status_date (status, appointmentDate)
);

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
);

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
);

CREATE TABLE IF NOT EXISTS Appointment_Services (
    appointmentId INT NOT NULL,
    serviceId INT NOT NULL,
    PRIMARY KEY (appointmentId, serviceId),
    FOREIGN KEY (appointmentId) REFERENCES Appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (serviceId) REFERENCES Services(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS MedicalRecords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointmentId INT NOT NULL,
    patientId INT NOT NULL,
    dentistId INT NOT NULL,
    diagnosis TEXT NOT NULL,
    chiefComplaint TEXT,
    treatmentPlan TEXT,
    treatmentSessions TEXT,
    procedures TEXT,
    toothPositions TEXT,
    prescription TEXT,
    notes TEXT,
    nextAppointmentDate DATE,
    nextAppointmentNote TEXT,
    nextAppointmentReminderSentAt TIMESTAMP NULL,
    nextAppointmentEmailReminderSentAt TIMESTAMP NULL,
    attachments TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_medical_records_appointment (appointmentId),
    FOREIGN KEY (appointmentId) REFERENCES Appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (patientId) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (dentistId) REFERENCES Users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointmentId INT NOT NULL,
    patientId INT NOT NULL,
    subtotalAmount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    discountAmount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    paidAmount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    totalAmount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    status ENUM('unpaid', 'partial', 'paid', 'cancelled') DEFAULT 'unpaid',
    paymentMethod ENUM('cash', 'card', 'transfer') DEFAULT 'cash',
    note TEXT,
    cancelledReason TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_invoices_appointment (appointmentId),
    FOREIGN KEY (appointmentId) REFERENCES Appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (patientId) REFERENCES Users(id) ON DELETE CASCADE
);

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
);

CREATE TABLE IF NOT EXISTS ChatMessages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    senderId INT NOT NULL,
    receiverId INT DEFAULT NULL,
    message TEXT NOT NULL,
    isAssistant TINYINT(1) DEFAULT 0,
    assistantName VARCHAR(120) DEFAULT NULL,
    metadata TEXT,
    readAt TIMESTAMP NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (senderId) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiverId) REFERENCES Users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ChatConversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patientId INT NOT NULL UNIQUE,
    assignedTo INT,
    status ENUM('new', 'open', 'closed') DEFAULT 'new',
    needsStaff TINYINT(1) DEFAULT 0,
    priorityReason VARCHAR(255),
    closedAt TIMESTAMP NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (assignedTo) REFERENCES Users(id) ON DELETE SET NULL,
    INDEX idx_chat_conversations_status (status, updatedAt)
);

CREATE TABLE IF NOT EXISTS Roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    roleId INT NOT NULL,
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (roleId) REFERENCES Roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Promotions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    discountPercent INT DEFAULT 0,
    startDate DATE,
    endDate DATE,
    isActive TINYINT(1) DEFAULT 1,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_promotions_active_dates (isActive, startDate, endDate)
);

CREATE TABLE IF NOT EXISTS Payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoiceId INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    paymentMethod ENUM('cash', 'card', 'transfer', 'vnpay', 'momo') NOT NULL,
    transactionId VARCHAR(100),
    status ENUM('pending', 'success', 'failed', 'refunded') DEFAULT 'success',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoiceId) REFERENCES Invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    isRead BOOLEAN DEFAULT FALSE,
    type ENUM('system', 'appointment', 'payment', 'chat', 'leave') DEFAULT 'system',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS NotificationPreferences (
    userId INT PRIMARY KEY,
    appointment TINYINT(1) DEFAULT 1,
    payment TINYINT(1) DEFAULT 1,
    chat TINYINT(1) DEFAULT 1,
    systemNotice TINYINT(1) DEFAULT 1,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ActivityLogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT,
    action VARCHAR(255) NOT NULL,
    entity VARCHAR(100),
    entityId INT,
    details TEXT,
    ipAddress VARCHAR(50),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    patientId INT NOT NULL,
    appointmentId INT NOT NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    status ENUM('pending', 'approved', 'hidden') DEFAULT 'pending',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_reviews_appointment (appointmentId),
    FOREIGN KEY (patientId) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (appointmentId) REFERENCES Appointments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    settingKey VARCHAR(100) UNIQUE NOT NULL,
    settingValue TEXT,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
