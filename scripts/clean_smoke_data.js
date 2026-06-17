const pool = require('../src/config/database');

const SMOKE_NOTE = 'Smoke test appointment';

async function cleanSmokeData() {
    try {
        const [appointments] = await pool.query(
            'SELECT id FROM Appointments WHERE notes = ?',
            [SMOKE_NOTE]
        );
        const appointmentIds = appointments.map((appointment) => appointment.id);

        if (appointmentIds.length === 0) {
            console.log('No smoke test appointments found.');
            return;
        }

        await pool.query('DELETE FROM ActivityLogs WHERE details LIKE ?', ['%Smoke test appointment%']);
        await pool.query('DELETE FROM Appointments WHERE id IN (?)', [appointmentIds]);

        console.log(`Deleted ${appointmentIds.length} smoke test appointment(s).`);
    } catch (error) {
        console.error('Error cleaning smoke test data:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

cleanSmokeData();
