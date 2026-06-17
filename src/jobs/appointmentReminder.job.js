const pool = require('../config/database');
const { createNotificationsForRoles } = require('../services/notification.service');

const getReminderHours = async (connection) => {
    const [rows] = await connection.query(
        'SELECT settingValue FROM Settings WHERE settingKey = "appointmentReminderHours" LIMIT 1'
    );
    const value = Number(rows[0]?.settingValue ?? 4);
    return Number.isFinite(value) && value >= 1 ? value : 4;
};

const runAppointmentReminderScan = async () => {
    const connection = await pool.getConnection();

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

        await connection.commit();
        return appointments.length;
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
