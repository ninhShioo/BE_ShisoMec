const pool = require('../config/database');

const validDayOfWeek = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 6;
const validTime = (value) => /^\d{2}:\d{2}(:\d{2})?$/.test(value || '');

const normalizeTime = (value) => value.length === 5 ? `${value}:00` : value;
const timeToMinutes = (time) => {
    const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
    return hour * 60 + minute;
};

const scheduleController = {
    getDentistSchedule: async (req, res, next) => {
        try {
            const dentistId = Number(req.params.dentistId);
            if (!Number.isInteger(dentistId) || dentistId <= 0) {
                return res.status(400).json({ success: false, message: 'ID bác sĩ không hợp lệ.' });
            }

            if (req.user.role === 'dentist' && req.user.id !== dentistId) {
                return res.status(403).json({ success: false, message: 'Bạn chỉ được xem lịch làm việc của chính mình.' });
            }

            const [rows] = await pool.query(
                `SELECT id, dentistId, dayOfWeek, startTime, endTime, breakStart, breakEnd, slotIntervalMinutes, isActive
                 FROM DoctorSchedules
                 WHERE dentistId = ?
                 ORDER BY dayOfWeek ASC`,
                [dentistId]
            );

            res.json({ success: true, message: 'Lấy lịch làm việc thành công.', data: rows });
        } catch (error) {
            next(error);
        }
    },

    updateDentistSchedule: async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const dentistId = Number(req.params.dentistId);
            const schedules = Array.isArray(req.body.schedules) ? req.body.schedules : [];

            if (!Number.isInteger(dentistId) || dentistId <= 0) {
                return res.status(400).json({ success: false, message: 'ID bác sĩ không hợp lệ.' });
            }

            const [dentists] = await connection.query(
                'SELECT id FROM Users WHERE id = ? AND role = "dentist" AND status = "active"',
                [dentistId]
            );
            if (dentists.length === 0) {
                return res.status(404).json({ success: false, message: 'Bác sĩ không tồn tại hoặc đang bị khóa.' });
            }

            if (schedules.length === 0) {
                return res.status(400).json({ success: false, message: 'Vui lòng cung cấp lịch làm việc.' });
            }

            await connection.beginTransaction();

            for (const item of schedules) {
                const dayOfWeek = Number(item.dayOfWeek);
                const startTime = normalizeTime(item.startTime || '');
                const endTime = normalizeTime(item.endTime || '');
                const breakStart = item.breakStart ? normalizeTime(item.breakStart) : null;
                const breakEnd = item.breakEnd ? normalizeTime(item.breakEnd) : null;
                const slotIntervalMinutes = Number(item.slotIntervalMinutes || 30);
                const isActive = item.isActive === false || item.isActive === 0 ? 0 : 1;

                if (!validDayOfWeek(dayOfWeek) || !validTime(startTime) || !validTime(endTime)) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Dữ liệu lịch làm việc không hợp lệ.' });
                }

                const startMinutes = timeToMinutes(startTime);
                const endMinutes = timeToMinutes(endTime);
                if (startMinutes >= endMinutes) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Giờ bắt đầu phải nhỏ hơn giờ kết thúc.' });
                }

                if ((breakStart && !breakEnd) || (!breakStart && breakEnd)) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Cần nhập đủ giờ bắt đầu và kết thúc nghỉ giữa ca.' });
                }

                if (breakStart && breakEnd) {
                    const breakStartMinutes = timeToMinutes(breakStart);
                    const breakEndMinutes = timeToMinutes(breakEnd);
                    if (breakStartMinutes >= breakEndMinutes || breakStartMinutes < startMinutes || breakEndMinutes > endMinutes) {
                        await connection.rollback();
                        return res.status(400).json({ success: false, message: 'Giờ nghỉ giữa ca phải nằm trong lịch làm việc.' });
                    }
                }

                if (!Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes < 15 || slotIntervalMinutes > 120) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Khoảng slot phải từ 15 đến 120 phút.' });
                }

                await connection.query(
                    `INSERT INTO DoctorSchedules
                        (dentistId, dayOfWeek, startTime, endTime, breakStart, breakEnd, slotIntervalMinutes, isActive)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        startTime = VALUES(startTime),
                        endTime = VALUES(endTime),
                        breakStart = VALUES(breakStart),
                        breakEnd = VALUES(breakEnd),
                        slotIntervalMinutes = VALUES(slotIntervalMinutes),
                        isActive = VALUES(isActive)`,
                    [dentistId, dayOfWeek, startTime, endTime, breakStart, breakEnd, slotIntervalMinutes, isActive]
                );
            }

            await connection.commit();
            res.json({ success: true, message: 'Cập nhật lịch làm việc thành công.' });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    getDaysOff: async (req, res, next) => {
        try {
            const dentistId = Number(req.query.dentistId || req.user.id);

            if (req.user.role === 'dentist' && req.user.id !== dentistId) {
                return res.status(403).json({ success: false, message: 'Bạn chỉ được xem ngày nghỉ của chính mình.' });
            }

            const [rows] = await pool.query(
                `SELECT id, dentistId, offDate, reason, createdAt
                 FROM DoctorDaysOff
                 WHERE dentistId = ?
                 ORDER BY offDate DESC`,
                [dentistId]
            );
            res.json({ success: true, message: 'Lấy ngày nghỉ thành công.', data: rows });
        } catch (error) {
            next(error);
        }
    },

    createDayOff: async (req, res, next) => {
        try {
            const dentistId = Number(req.body.dentistId);
            const { offDate, reason } = req.body;

            if (!Number.isInteger(dentistId) || dentistId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(offDate || '')) {
                return res.status(400).json({ success: false, message: 'Dữ liệu ngày nghỉ không hợp lệ.' });
            }

            const [result] = await pool.query(
                `INSERT INTO DoctorDaysOff (dentistId, offDate, reason)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
                [dentistId, offDate, reason || null]
            );

            res.status(201).json({ success: true, message: 'Thêm ngày nghỉ thành công.', data: { id: result.insertId } });
        } catch (error) {
            next(error);
        }
    },

    deleteDayOff: async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID ngày nghỉ không hợp lệ.' });
            }

            await pool.query('DELETE FROM DoctorDaysOff WHERE id = ?', [id]);
            res.json({ success: true, message: 'Đã xóa ngày nghỉ.' });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = scheduleController;
