const pool = require('../config/database');
const { createAppointmentRecord } = require('../controllers/appointment.controller');

const createChatAppointmentTool = ({ database = pool, createRecord = createAppointmentRecord } = {}) => ({
    execute: async (input) => {
        const connection = await database.getConnection();
        try {
            await connection.beginTransaction();
            const result = await createRecord(connection, input);
            await connection.commit();
            return result;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
});

const chatAppointmentTool = createChatAppointmentTool();

module.exports = {
    createChatAppointmentTool,
    createAppointmentFromChat: chatAppointmentTool.execute
};
