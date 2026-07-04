const pool = require('../config/database');
const { createNotification, createNotificationsForRoles } = require('../services/notification.service');
const { isEmailEnabled, sendAppointmentReminderEmail, sendFollowUpReminderEmail } = require('../services/email.service');

const getReminderHours = async (connection) => {
    const [rows] = await connection.query(
        'SELECT settingValue FROM Settings WHERE settingKey = "appointmentReminderHours" LIMIT 1'
    );
    const value = Number(rows[0]?.settingValue ?? 4);
    return Number.isFinite(value) && value >= 1 ? value : 4;
};

const runAppointmentReminderScan = async () => {
    const connection = await pool.getConnection();
    const emailJobs = [];
    const followUpEmailJobs = [];

    try {
        await connection.beginTransaction();
        const reminderHours = await getReminderHours(connection);
        const [appointments] = await connection.query(`
            SELECT a.id, a.appointmentDate, a.appointmentTime, p.fullName as patientName
            FROM Appointments a
            JOIN Users p ON p.id = a.patientId
            WHERE a.status = "pending"
            AND a.confirmationReminderSentAt IS NULL
            AND TIMESTAMP(a.appointmentDate, a.appointmentTime) BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? HOUR)
            FOR UPDATE
        `, [reminderHours]);

        for (const appointment of appointments) {
            await createNotificationsForRoles(
                connection,
                ['admin', 'staff'],
                'Lịch hẹn sắp đến chưa xác nhận',
                `Lịch hẹn #${appointment.id} của ${appointment.patientName} sắp đến giờ nhưng vẫn đang chờ xác nhận.`,
                'appointment'
            );
            await connection.query(
                'UPDATE Appointments SET confirmationReminderSentAt = NOW() WHERE id = ?',
                [appointment.id]
            );
        }

        if (isEmailEnabled()) {
            const [emailAppointments] = await connection.query(`
                SELECT a.id, a.appointmentDate, a.appointmentTime,
                       p.fullName as patientName, p.email as patientEmail,
                       d.fullName as dentistName,
                       GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') as serviceNames
                FROM Appointments a
                JOIN Users p ON p.id = a.patientId
                LEFT JOIN Users d ON d.id = a.dentistId
                LEFT JOIN Appointment_Services aps ON aps.appointmentId = a.id
                LEFT JOIN Services s ON s.id = aps.serviceId
                WHERE a.status IN ("confirmed", "arrived")
                AND a.appointmentReminderEmailSentAt IS NULL
                AND p.googleLinkedAt IS NOT NULL
                AND p.email IS NOT NULL
                AND p.email <> ""
                AND TIMESTAMP(a.appointmentDate, a.appointmentTime) BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? HOUR)
                GROUP BY a.id, a.appointmentDate, a.appointmentTime, p.fullName, p.email, d.fullName
            `, [reminderHours]);

            emailJobs.push(...emailAppointments);
        }

        const [followUpRecords] = await connection.query(`
            SELECT
                m.id,
                m.patientId,
                m.dentistId,
                m.appointmentId,
                m.diagnosis,
                m.nextAppointmentDate,
                m.nextAppointmentNote,
                m.nextAppointmentReminderSentAt,
                m.nextAppointmentEmailReminderSentAt,
                p.fullName as patientName,
                p.email as patientEmail,
                p.googleLinkedAt,
                d.fullName as dentistName
            FROM MedicalRecords m
            JOIN Users p ON p.id = m.patientId
            LEFT JOIN Users d ON d.id = m.dentistId
            WHERE m.nextAppointmentDate IS NOT NULL
              AND (
                    m.nextAppointmentReminderSentAt IS NULL
                    OR (
                        m.nextAppointmentEmailReminderSentAt IS NULL
                        AND p.googleLinkedAt IS NOT NULL
                        AND p.email IS NOT NULL
                        AND p.email <> ""
                    )
              )
              AND m.nextAppointmentDate <= CURDATE()
            FOR UPDATE
        `);

        for (const record of followUpRecords) {
            if (!record.nextAppointmentReminderSentAt) {
            await createNotification(
                connection,
                record.patientId,
                'Đến lịch tái khám',
                `Hồ sơ khám của bạn đã đến ngày tái khám${record.nextAppointmentNote ? `: ${record.nextAppointmentNote}` : '.'}`,
                'appointment'
            );
            await connection.query(
                'UPDATE MedicalRecords SET nextAppointmentReminderSentAt = NOW() WHERE id = ?',
                [record.id]
            );
            }

            if (
                isEmailEnabled()
                && record.patientEmail
                && String(record.patientEmail).trim()
                && record.googleLinkedAt
                && !record.nextAppointmentEmailReminderSentAt
            ) {
                followUpEmailJobs.push(record);
            }
        }

        await connection.commit();

        let sentEmails = 0;
        for (const appointment of emailJobs) {
            try {
                const result = await sendAppointmentReminderEmail(appointment);
                if (!result.skipped) {
                    await pool.query(
                        'UPDATE Appointments SET appointmentReminderEmailSentAt = NOW() WHERE id = ? AND appointmentReminderEmailSentAt IS NULL',
                        [appointment.id]
                    );
                    sentEmails += 1;
                }
            } catch (error) {
                console.error(`Appointment reminder email #${appointment.id} failed:`, error.message);
            }
        }

        let sentFollowUpEmails = 0;
        for (const record of followUpEmailJobs) {
            try {
                const result = await sendFollowUpReminderEmail(record);
                if (!result.skipped) {
                    await pool.query(
                        'UPDATE MedicalRecords SET nextAppointmentEmailReminderSentAt = NOW() WHERE id = ? AND nextAppointmentEmailReminderSentAt IS NULL',
                        [record.id]
                    );
                    sentFollowUpEmails += 1;
                }
            } catch (error) {
                console.error(`Follow-up reminder email #${record.id} failed:`, error.message);
            }
        }

        return {
            staffReminders: appointments.length,
            emailReminders: sentEmails,
            followUpReminders: followUpRecords.length,
            followUpEmailReminders: sentFollowUpEmails
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const startAppointmentReminderJob = () => {
    const intervalMs = Number(process.env.APPOINTMENT_REMINDER_INTERVAL_MS || 5 * 60 * 1000);
    const timer = setInterval(() => {
        runAppointmentReminderScan().catch((error) => {
            console.error('Appointment reminder job failed:', error.message);
        });
    }, intervalMs);

    timer.unref();
    runAppointmentReminderScan().catch((error) => {
        console.error('Appointment reminder initial scan failed:', error.message);
    });

    return timer;
};

module.exports = {
    runAppointmentReminderScan,
    startAppointmentReminderJob
};
