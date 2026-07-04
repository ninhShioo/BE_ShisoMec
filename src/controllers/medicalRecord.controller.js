const pool = require('../config/database');
const { createNotification } = require('../services/notification.service');

const parseAttachments = (attachments) => {
    if (!attachments) return null;

    try {
        if (typeof attachments === 'string') {
            const parsed = JSON.parse(attachments);
            return JSON.stringify(Array.isArray(parsed) ? parsed : []);
        }

        return JSON.stringify(Array.isArray(attachments) ? attachments : []);
    } catch {
        return JSON.stringify([]);
    }
};

const parseJsonArray = (value) => {
    if (!value) return JSON.stringify([]);

    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return JSON.stringify(Array.isArray(parsed) ? parsed : []);
    } catch {
        return JSON.stringify([]);
    }
};

const cleanText = (value) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
};

const normalizeDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return [
            value.getFullYear(),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0')
        ].join('-');
    }
    const text = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

const todayValue = () => {
    const now = new Date();
    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('-');
};

const recordAppointmentStatusHistory = async (connection, appointmentId, oldStatus, newStatus, userId, reason = null, note = null) => {
    try {
        await connection.query(
            `INSERT INTO AppointmentStatusHistory
             (appointmentId, oldStatus, newStatus, changedBy, reason, note)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [appointmentId, oldStatus || null, newStatus, userId || null, reason || null, note || null]
        );
    } catch (error) {
        console.warn(`Skipped AppointmentStatusHistory insert: ${error.message}`);
    }
};

const mapRecord = (record) => ({
    ...record,
    toothPositions: (() => {
        try {
            const parsed = JSON.parse(record.toothPositions || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    })(),
    treatmentSessions: (() => {
        try {
            const parsed = JSON.parse(record.treatmentSessions || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    })(),
    attachments: (() => {
        try {
            const parsed = JSON.parse(record.attachments || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    })()
});

const medicalRecordController = {
    getRecords: async (req, res, next) => {
        try {
            if (!['admin', 'staff', 'dentist'].includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn không có quyền xem danh sách hồ sơ khám.'
                });
            }

            const { search = '', dentistId = '', patientId = '', dateFrom = '', dateTo = '', followUp = '' } = req.query;
            const conditions = [];
            const params = [];

            if (req.user.role === 'dentist') {
                conditions.push('m.dentistId = ?');
                params.push(req.user.id);
            } else if (dentistId && dentistId !== 'all') {
                conditions.push('m.dentistId = ?');
                params.push(Number(dentistId));
            }

            if (patientId && patientId !== 'all') {
                conditions.push('m.patientId = ?');
                params.push(Number(patientId));
            }

            if (dateFrom) {
                conditions.push('a.appointmentDate >= ?');
                params.push(normalizeDate(dateFrom));
            }

            if (dateTo) {
                conditions.push('a.appointmentDate <= ?');
                params.push(normalizeDate(dateTo));
            }

            if (followUp === 'due') {
                conditions.push('m.nextAppointmentDate IS NOT NULL AND m.nextAppointmentDate <= CURDATE()');
            } else if (followUp === 'upcoming') {
                conditions.push('m.nextAppointmentDate IS NOT NULL AND m.nextAppointmentDate > CURDATE()');
            }

            const keyword = String(search || '').trim();
            if (keyword) {
                conditions.push(`(
                    p.fullName LIKE ?
                    OR p.phone LIKE ?
                    OR p.email LIKE ?
                    OR d.fullName LIKE ?
                    OR m.diagnosis LIKE ?
                    OR m.chiefComplaint LIKE ?
                    OR m.treatmentPlan LIKE ?
                    OR m.procedures LIKE ?
                )`);
                const pattern = `%${keyword}%`;
                params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
            }

            const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
            const [records] = await pool.query(
                `SELECT
                    m.id, m.appointmentId, m.patientId, m.dentistId, m.diagnosis, m.chiefComplaint,
                    m.treatmentPlan, m.treatmentSessions, m.toothPositions, m.procedures,
                    m.prescription, m.notes, m.nextAppointmentDate, m.nextAppointmentNote,
                    m.nextAppointmentReminderSentAt, m.nextAppointmentEmailReminderSentAt,
                    m.attachments, m.createdAt, m.updatedAt,
                    a.appointmentDate, a.appointmentTime,
                    p.fullName as patientName, p.phone as patientPhone, p.email as patientEmail,
                    d.fullName as dentistName,
                    svc.serviceNames
                 FROM MedicalRecords m
                 JOIN Appointments a ON m.appointmentId = a.id
                 JOIN Users p ON m.patientId = p.id
                 JOIN Users d ON m.dentistId = d.id
                 LEFT JOIN (
                    SELECT
                        asv.appointmentId,
                        GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') as serviceNames
                    FROM Appointment_Services asv
                    JOIN Services s ON asv.serviceId = s.id
                    GROUP BY asv.appointmentId
                 ) svc ON svc.appointmentId = a.id
                 ${whereClause}
                 ORDER BY a.appointmentDate DESC, a.appointmentTime DESC, m.createdAt DESC
                 LIMIT 200`,
                params
            );

            res.json({
                success: true,
                message: 'Lấy danh sách hồ sơ khám thành công.',
                data: records.map(mapRecord)
            });
        } catch (error) {
            next(error);
        }
    },

    createRecord: async (req, res, next) => {
        const connection = await pool.getConnection();

        try {
            const appointmentId = Number(req.body.appointmentId);
            const {
                chiefComplaint,
                diagnosis,
                treatmentPlan,
                treatmentSessions,
                procedures,
                toothPositions,
                prescription,
                notes,
                nextAppointmentDate,
                nextAppointmentNote,
                attachments
            } = req.body;

            if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
                return res.status(400).json({ success: false, message: 'ID lịch hẹn không hợp lệ.' });
            }

            if (!cleanText(diagnosis)) {
                return res.status(400).json({ success: false, message: 'Chẩn đoán là bắt buộc.' });
            }

            await connection.beginTransaction();

            const [appointments] = await connection.query(
                'SELECT patientId, dentistId, status, appointmentDate FROM Appointments WHERE id = ? FOR UPDATE',
                [appointmentId]
            );
            if (appointments.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn.' });
            }

            const appointment = appointments[0];
            if (!appointment.dentistId) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Lịch hẹn chưa được phân công bác sĩ.'
                });
            }

            if (req.user.role === 'dentist' && appointment.dentistId !== req.user.id) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'Bạn chỉ được tạo hồ sơ cho lịch hẹn do mình phụ trách.'
                });
            }

            if (!['arrived', 'in_progress'].includes(appointment.status)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Chỉ có thể tạo hồ sơ khi khách đã check-in hoặc đang khám.'
                });
            }

            const [existingRecords] = await connection.query(
                'SELECT id FROM MedicalRecords WHERE appointmentId = ? LIMIT 1',
                [appointmentId]
            );
            if (existingRecords.length > 0) {
                await connection.rollback();
                return res.status(409).json({ success: false, message: 'Lịch hẹn này đã có hồ sơ khám.' });
            }

            const normalizedNextDate = normalizeDate(nextAppointmentDate);
            const appointmentDate = normalizeDate(appointment.appointmentDate);
            const minNextDate = [todayValue(), appointmentDate].filter(Boolean).sort().pop();
            if (normalizedNextDate && normalizedNextDate <= minNextDate) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Ngày tái khám phải là ngày tiếp theo, không được là hôm nay hoặc trong quá khứ.'
                });
            }

            await connection.query(
                `INSERT INTO MedicalRecords
                 (appointmentId, patientId, dentistId, diagnosis, chiefComplaint, treatmentPlan, procedures,
                  treatmentSessions, toothPositions, prescription, notes, nextAppointmentDate, nextAppointmentNote, attachments)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    appointmentId,
                    appointment.patientId,
                    appointment.dentistId,
                    cleanText(diagnosis),
                    cleanText(chiefComplaint),
                    cleanText(treatmentPlan),
                    cleanText(procedures),
                    parseJsonArray(treatmentSessions),
                    parseJsonArray(toothPositions),
                    cleanText(prescription),
                    cleanText(notes),
                    normalizedNextDate,
                    cleanText(nextAppointmentNote),
                    parseAttachments(attachments)
                ]
            );

            await connection.query(
                'UPDATE Appointments SET status = "completed", completedAt = NOW(), statusChangedAt = NOW(), statusNote = ? WHERE id = ?',
                ['Hoàn thành sau khi lưu hồ sơ khám', appointmentId]
            );
            await recordAppointmentStatusHistory(
                connection,
                appointmentId,
                appointment.status,
                'completed',
                req.user.id,
                'Lưu hồ sơ khám',
                cleanText(procedures) || cleanText(notes)
            );

            await createNotification(
                connection,
                appointment.patientId,
                'Hồ sơ khám đã được cập nhật',
                `Bác sĩ đã hoàn tất hồ sơ khám cho lịch hẹn #${appointmentId}.`,
                'appointment'
            );

            await connection.commit();

            res.status(201).json({
                success: true,
                message: 'Tạo hồ sơ khám thành công.'
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    getRecordsByPatient: async (req, res, next) => {
        try {
            const targetPatientId = Number(req.params.patientId);

            if (!Number.isInteger(targetPatientId) || targetPatientId <= 0) {
                return res.status(400).json({ success: false, message: 'ID bệnh nhân không hợp lệ.' });
            }

            if (req.user.role === 'patient' && targetPatientId !== req.user.id) {
                return res.status(403).json({
                    success: false,
                    message: 'Bạn chỉ được xem hồ sơ khám của chính mình.'
                });
            }

            let query = `
                SELECT
                    m.id, m.appointmentId, m.diagnosis, m.chiefComplaint, m.treatmentPlan, m.treatmentSessions,
                    m.toothPositions, m.procedures,
                    m.prescription, m.notes, m.nextAppointmentDate, m.nextAppointmentNote,
                    m.nextAppointmentReminderSentAt, m.nextAppointmentEmailReminderSentAt, m.attachments,
                    m.createdAt, m.updatedAt,
                    a.appointmentDate, a.appointmentTime,
                    d.fullName as dentistName,
                    svc.serviceNames
                FROM MedicalRecords m
                JOIN Appointments a ON m.appointmentId = a.id
                JOIN Users d ON m.dentistId = d.id
                LEFT JOIN (
                    SELECT
                        asv.appointmentId,
                        GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') as serviceNames
                    FROM Appointment_Services asv
                    JOIN Services s ON asv.serviceId = s.id
                    GROUP BY asv.appointmentId
                ) svc ON svc.appointmentId = a.id
                WHERE m.patientId = ?
            `;
            const queryParams = [targetPatientId];

            if (req.user.role === 'dentist') {
                query += ` AND EXISTS (
                    SELECT 1
                    FROM Appointments own
                    WHERE own.patientId = m.patientId
                    AND own.dentistId = ?
                )`;
                queryParams.push(req.user.id);
            }

            query += ' ORDER BY a.appointmentDate DESC, a.appointmentTime DESC, m.createdAt DESC';

            const [records] = await pool.query(query, queryParams);

            res.json({
                success: true,
                message: 'Lấy hồ sơ khám thành công.',
                data: records.map(mapRecord)
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = medicalRecordController;
