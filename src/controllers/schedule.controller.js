const pool = require('../config/database');
const { createNotification, createNotificationsForRoles } = require('../services/notification.service');

const validDayOfWeek = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 6;
const validTime = (value) => /^\d{2}:\d{2}(:\d{2})?$/.test(value || '');
const activeAppointmentStatuses = ['pending', 'confirmed', 'arrived', 'in_progress'];

const normalizeTime = (value) => value.length === 5 ? `${value}:00` : value;
const timeToMinutes = (time) => {
    const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
    return hour * 60 + minute;
};
const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;
const normalizeDateValue = (value) => {
    if (value instanceof Date) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    return String(value || '').slice(0, 10);
};

const todayValue = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const appointmentFitsSchedule = (appointment, schedule) => {
    if (!schedule || Number(schedule.isActive) !== 1) return false;

    const start = timeToMinutes(appointment.appointmentTime);
    const end = start + Math.max(Number(appointment.duration || 30), 30);
    const workStart = timeToMinutes(schedule.startTime);
    const workEnd = timeToMinutes(schedule.endTime);
    const interval = Number(schedule.slotIntervalMinutes || 30);

    if (start < workStart || end > workEnd) return false;
    if ((start - workStart) % interval !== 0) return false;

    if (schedule.breakStart && schedule.breakEnd) {
        const breakStart = timeToMinutes(schedule.breakStart);
        const breakEnd = timeToMinutes(schedule.breakEnd);
        if (rangesOverlap(start, end, breakStart, breakEnd)) return false;
    }

    return true;
};

const getFutureActiveAppointments = async (connection, dentistId) => {
    const [rows] = await connection.query(
        `SELECT
            a.id,
            a.appointmentDate,
            a.appointmentTime,
            COALESCE(SUM(COALESCE(s.duration, 30)), 30) as duration,
            p.fullName as patientName
         FROM Appointments a
         JOIN Users p ON p.id = a.patientId
         LEFT JOIN Appointment_Services aps ON aps.appointmentId = a.id
         LEFT JOIN Services s ON s.id = aps.serviceId
         WHERE a.dentistId = ?
           AND a.appointmentDate >= CURDATE()
           AND a.status IN (?)
         GROUP BY a.id, a.appointmentDate, a.appointmentTime, p.fullName
         ORDER BY a.appointmentDate ASC, a.appointmentTime ASC`,
        [dentistId, activeAppointmentStatuses]
    );

    return rows.map((row) => ({
        ...row,
        appointmentDate: normalizeDateValue(row.appointmentDate)
    }));
};

const hasActiveAppointmentsOnDate = async (connection, dentistId, offDate) => {
    const [rows] = await connection.query(
        `SELECT a.id, a.appointmentTime, p.fullName as patientName
         FROM Appointments a
         JOIN Users p ON p.id = a.patientId
         WHERE a.dentistId = ?
           AND a.appointmentDate = ?
           AND a.status IN (?)
         ORDER BY a.appointmentTime ASC`,
        [dentistId, offDate, activeAppointmentStatuses]
    );
    return rows;
};

const scheduleController = {
    getDentistSchedule: async (req, res, next) => {
        try {
            const dentistId = Number(req.params.dentistId);
            if (!Number.isInteger(dentistId) || dentistId <= 0) {
                return res.status(400).json({ success: false, message: 'ID bác sĩ không hợp lệ.' });
            }

            if (req.user.role === 'dentist' && Number(req.user.id) !== dentistId) {
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

            const normalizedSchedules = [];
            const seenDays = new Set();

            for (const item of schedules) {
                const dayOfWeek = Number(item.dayOfWeek);
                const startTime = normalizeTime(item.startTime || '');
                const endTime = normalizeTime(item.endTime || '');
                const breakStart = item.breakStart ? normalizeTime(item.breakStart) : null;
                const breakEnd = item.breakEnd ? normalizeTime(item.breakEnd) : null;
                const slotIntervalMinutes = Number(item.slotIntervalMinutes || 30);
                const isActive = item.isActive === false || item.isActive === 0 ? 0 : 1;

                if (seenDays.has(dayOfWeek)) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Mỗi ngày trong tuần chỉ được cấu hình một lần.' });
                }
                seenDays.add(dayOfWeek);

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

                normalizedSchedules.push({
                    dayOfWeek,
                    startTime,
                    endTime,
                    breakStart,
                    breakEnd,
                    slotIntervalMinutes,
                    isActive
                });
            }

            const schedulesByDay = new Map(normalizedSchedules.map((item) => [item.dayOfWeek, item]));
            const futureAppointments = await getFutureActiveAppointments(connection, dentistId);
            const invalidAppointment = futureAppointments.find((appointment) => {
                const dayOfWeek = new Date(`${appointment.appointmentDate}T00:00:00`).getDay();
                if (!schedulesByDay.has(dayOfWeek)) return false;
                return !appointmentFitsSchedule(appointment, schedulesByDay.get(dayOfWeek));
            });

            if (invalidAppointment) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    message: `Không thể lưu vì lịch hẹn #${invalidAppointment.id} (${invalidAppointment.patientName}, ${invalidAppointment.appointmentDate} ${String(invalidAppointment.appointmentTime).slice(0, 5)}) sẽ nằm ngoài lịch làm việc mới. Hãy dời/hủy lịch hẹn trước.`
                });
            }

            for (const item of normalizedSchedules) {
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
                    [dentistId, item.dayOfWeek, item.startTime, item.endTime, item.breakStart, item.breakEnd, item.slotIntervalMinutes, item.isActive]
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

            if (req.user.role === 'dentist' && Number(req.user.id) !== dentistId) {
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

            if (offDate < todayValue()) {
                return res.status(400).json({ success: false, message: 'Không thể thêm ngày nghỉ trong quá khứ.' });
            }

            const [dentists] = await pool.query(
                'SELECT id FROM Users WHERE id = ? AND role = "dentist" AND status = "active"',
                [dentistId]
            );
            if (dentists.length === 0) {
                return res.status(404).json({ success: false, message: 'Bác sĩ không tồn tại hoặc đang bị khóa.' });
            }

            const activeAppointments = await hasActiveAppointmentsOnDate(pool, dentistId, offDate);
            if (activeAppointments.length > 0) {
                const firstAppointment = activeAppointments[0];
                return res.status(409).json({
                    success: false,
                    message: `Không thể thêm ngày nghỉ vì bác sĩ đã có lịch hẹn #${firstAppointment.id} lúc ${String(firstAppointment.appointmentTime).slice(0, 5)}. Hãy dời/hủy lịch trước.`
                });
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

            const [result] = await pool.query('DELETE FROM DoctorDaysOff WHERE id = ?', [id]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy ngày nghỉ.' });
            }
            res.json({ success: true, message: 'Đã xóa ngày nghỉ.' });
        } catch (error) {
            next(error);
        }
    },

    getDayOffRequests: async (req, res, next) => {
        try {
            const status = req.query.status;
            const queryParams = [];
            let query = `
                SELECT
                    r.id, r.dentistId, r.offDate, r.reason, r.status, r.reviewNote, r.createdAt, r.reviewedAt,
                    d.fullName as dentistName,
                    reviewer.fullName as reviewedByName
                FROM DoctorDayOffRequests r
                JOIN Users d ON d.id = r.dentistId
                LEFT JOIN Users reviewer ON reviewer.id = r.reviewedBy
                WHERE 1=1
            `;

            if (req.user.role === 'dentist') {
                query += ' AND r.dentistId = ?';
                queryParams.push(req.user.id);
            }

            if (status) {
                if (!['pending', 'approved', 'rejected'].includes(status)) {
                    return res.status(400).json({ success: false, message: 'Trạng thái yêu cầu nghỉ không hợp lệ.' });
                }
                query += ' AND r.status = ?';
                queryParams.push(status);
            }

            query += ' ORDER BY r.createdAt DESC';
            const [rows] = await pool.query(query, queryParams);

            res.json({ success: true, message: 'Lấy yêu cầu nghỉ thành công.', data: rows });
        } catch (error) {
            next(error);
        }
    },

    createDayOffRequest: async (req, res, next) => {
        try {
            const dentistId = req.user.id;
            const offDate = String(req.body.offDate || '').slice(0, 10);
            const reason = String(req.body.reason || '').trim();

            if (!/^\d{4}-\d{2}-\d{2}$/.test(offDate)) {
                return res.status(400).json({ success: false, message: 'Ngày nghỉ không hợp lệ.' });
            }

            if (offDate < todayValue()) {
                return res.status(400).json({ success: false, message: 'Không thể đăng ký nghỉ trong quá khứ.' });
            }

            const [existingDayOff] = await pool.query(
                'SELECT id FROM DoctorDaysOff WHERE dentistId = ? AND offDate = ? LIMIT 1',
                [dentistId, offDate]
            );
            if (existingDayOff.length > 0) {
                return res.status(409).json({ success: false, message: 'Ngày này đã được ghi nhận là ngày nghỉ.' });
            }

            const [pendingRequests] = await pool.query(
                'SELECT id FROM DoctorDayOffRequests WHERE dentistId = ? AND offDate = ? AND status = "pending" LIMIT 1',
                [dentistId, offDate]
            );
            if (pendingRequests.length > 0) {
                return res.status(409).json({ success: false, message: 'Bạn đã có yêu cầu nghỉ đang chờ duyệt cho ngày này.' });
            }

            const activeAppointments = await hasActiveAppointmentsOnDate(pool, dentistId, offDate);
            if (activeAppointments.length > 0) {
                const firstAppointment = activeAppointments[0];
                return res.status(409).json({
                    success: false,
                    message: `Ngày này đã có lịch hẹn #${firstAppointment.id} lúc ${String(firstAppointment.appointmentTime).slice(0, 5)}. Vui lòng báo lễ tân/admin dời lịch trước khi đăng ký nghỉ.`
                });
            }

            const [result] = await pool.query(
                'INSERT INTO DoctorDayOffRequests (dentistId, offDate, reason) VALUES (?, ?, ?)',
                [dentistId, offDate, reason || null]
            );

            await createNotificationsForRoles(
                pool,
                ['admin', 'staff'],
                'Bác sĩ đăng ký nghỉ',
                `${req.user.fullName} đăng ký nghỉ ngày ${offDate}${reason ? `: ${reason}` : '.'}`,
                'leave'
            );

            res.status(201).json({
                success: true,
                message: 'Đã gửi yêu cầu nghỉ, chờ duyệt.',
                data: { id: result.insertId }
            });
        } catch (error) {
            next(error);
        }
    },

    reviewDayOffRequest: async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const requestId = Number(req.params.requestId);
            const status = req.body.status;
            const reviewNote = String(req.body.reviewNote || '').trim();

            if (!Number.isInteger(requestId) || requestId <= 0) {
                return res.status(400).json({ success: false, message: 'ID yêu cầu nghỉ không hợp lệ.' });
            }

            if (!['approved', 'rejected'].includes(status)) {
                return res.status(400).json({ success: false, message: 'Trạng thái duyệt không hợp lệ.' });
            }

            await connection.beginTransaction();

            const [requests] = await connection.query(
                `SELECT r.*, d.fullName as dentistName
                 FROM DoctorDayOffRequests r
                 JOIN Users d ON d.id = r.dentistId
                 WHERE r.id = ?
                 FOR UPDATE`,
                [requestId]
            );
            if (requests.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu nghỉ.' });
            }

            const request = requests[0];
            if (request.status !== 'pending') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Yêu cầu nghỉ này đã được xử lý.' });
            }

            const offDate = normalizeDateValue(request.offDate);
            if (status === 'approved') {
                const activeAppointments = await hasActiveAppointmentsOnDate(connection, request.dentistId, offDate);
                if (activeAppointments.length > 0) {
                    await connection.rollback();
                    const firstAppointment = activeAppointments[0];
                    return res.status(409).json({
                        success: false,
                        message: `Không thể duyệt vì bác sĩ đã có lịch hẹn #${firstAppointment.id} lúc ${String(firstAppointment.appointmentTime).slice(0, 5)}.`
                    });
                }

                await connection.query(
                    `INSERT INTO DoctorDaysOff (dentistId, offDate, reason)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
                    [request.dentistId, offDate, request.reason || 'Đã duyệt yêu cầu nghỉ']
                );
            }

            await connection.query(
                `UPDATE DoctorDayOffRequests
                 SET status = ?, reviewedBy = ?, reviewNote = ?, reviewedAt = NOW()
                 WHERE id = ?`,
                [status, req.user.id, reviewNote || null, requestId]
            );

            await createNotification(
                connection,
                request.dentistId,
                status === 'approved' ? 'Yêu cầu nghỉ đã được duyệt' : 'Yêu cầu nghỉ đã bị từ chối',
                `Yêu cầu nghỉ ngày ${offDate} của bạn đã được ${status === 'approved' ? 'duyệt' : 'từ chối'}${reviewNote ? `: ${reviewNote}` : '.'}`,
                'leave'
            );

            await connection.commit();

            res.json({
                success: true,
                message: status === 'approved' ? 'Đã duyệt yêu cầu nghỉ.' : 'Đã từ chối yêu cầu nghỉ.'
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    }
};

module.exports = scheduleController;
