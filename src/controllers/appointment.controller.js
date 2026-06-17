const pool = require('../config/database');
const { createNotification, createNotificationsForRoles } = require('../services/notification.service');

const validAppointmentStatuses = ['pending', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'];
const terminalAppointmentStatuses = ['completed', 'cancelled', 'no_show'];

const statusLabels = {
    pending: 'Chờ xác nhận',
    confirmed: 'Đã xác nhận',
    arrived: 'Khách đã đến',
    in_progress: 'Đang khám',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy',
    no_show: 'Không đến'
};

const buildAppointmentDateTime = (appointmentDate, appointmentTime) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) || !/^\d{2}:\d{2}(:\d{2})?$/.test(appointmentTime)) {
        return null;
    }

    const normalizedTime = appointmentTime.length === 5 ? `${appointmentTime}:00` : appointmentTime;
    const appointmentDateTime = new Date(`${appointmentDate}T${normalizedTime}`);

    return Number.isNaN(appointmentDateTime.getTime()) ? null : appointmentDateTime;
};

const getBookingLeadHours = async (connection) => {
    const [rows] = await connection.query(
        'SELECT settingValue FROM Settings WHERE settingKey = "bookingLeadHours" LIMIT 1'
    );
    const value = Number(rows[0]?.settingValue ?? 24);
    return Number.isFinite(value) && value >= 0 ? value : 24;
};

const getEarliestBookableDateTime = (leadHours = 24) => new Date(Date.now() + leadHours * 60 * 60 * 1000);

const normalizeServiceIds = (serviceIds) => {
    if (!Array.isArray(serviceIds)) return [];

    const normalizedIds = serviceIds
        .map((serviceId) => Number(serviceId))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0);

    return [...new Set(normalizedIds)];
};

const normalizeQueryServiceIds = (serviceIds) => {
    if (!serviceIds) return [];
    if (Array.isArray(serviceIds)) return normalizeServiceIds(serviceIds);
    return normalizeServiceIds(String(serviceIds).split(','));
};

const getServiceDuration = async (connection, serviceIds) => {
    const normalizedIds = normalizeServiceIds(serviceIds);
    if (normalizedIds.length === 0) return 30;

    const [rows] = await connection.query(
        'SELECT COALESCE(SUM(COALESCE(duration, 30)), 0) as totalDuration FROM Services WHERE id IN (?) AND status = "active"',
        [normalizedIds]
    );

    return Math.max(Number(rows[0]?.totalDuration || 0), 30);
};

const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

const getAppointmentBusyRanges = async (connection, columnName, userId, appointmentDate, excludeAppointmentId = null) => {
    if (!['patientId', 'dentistId'].includes(columnName)) {
        throw new Error('Invalid appointment owner column.');
    }

    let query = `
        SELECT 
            a.id,
            a.appointmentTime,
            COALESCE(SUM(COALESCE(s.duration, 30)), 30) as duration
        FROM Appointments a
        LEFT JOIN Appointment_Services aps ON aps.appointmentId = a.id
        LEFT JOIN Services s ON s.id = aps.serviceId
        WHERE a.${columnName} = ?
        AND a.appointmentDate = ?
        AND a.status NOT IN ("cancelled", "no_show")
    `;
    const params = [userId, appointmentDate];

    if (excludeAppointmentId) {
        query += ' AND a.id <> ?';
        params.push(excludeAppointmentId);
    }

    query += ' GROUP BY a.id, a.appointmentTime';

    const [rows] = await connection.query(query, params);
    return rows.map((row) => {
        const start = timeToMinutes(row.appointmentTime);
        const duration = Math.max(Number(row.duration || 30), 30);
        return {
            id: row.id,
            start,
            end: start + duration
        };
    });
};

const hasAppointmentOverlap = async (connection, columnName, userId, appointmentDate, startMinutes, duration, excludeAppointmentId = null) => {
    const endMinutes = startMinutes + duration;
    const busyRanges = await getAppointmentBusyRanges(connection, columnName, userId, appointmentDate, excludeAppointmentId);
    return busyRanges.some((range) => rangesOverlap(startMinutes, endMinutes, range.start, range.end));
};

const isBusinessError = (message) => [
    'Vui lòng',
    'Không thể',
    'không hợp lệ',
    'không tồn tại',
    'đang bị khóa',
    'đã có',
    'đã bị ẩn',
    'cần cung cấp',
    'Cần',
    'Bác sĩ',
    'Bệnh nhân',
    'Khung giờ'
].some((keyword) => message.includes(keyword));

const timeToMinutes = (time) => {
    const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
    return hour * 60 + minute;
};

const minutesToTime = (minutes) => {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const normalizeDateValue = (value) => {
    if (value instanceof Date) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    return String(value).slice(0, 10);
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

const getStatusTimestampColumn = (status) => ({
    arrived: 'checkedInAt',
    in_progress: 'startedAt',
    completed: 'completedAt',
    cancelled: 'cancelledAt',
    no_show: 'noShowAt'
}[status] || null);

const updateAppointmentStatusFields = async (connection, appointmentId, status, { reason = null, note = null } = {}) => {
    const timestampColumn = getStatusTimestampColumn(status);
    const updates = ['status = ?', 'statusChangedAt = NOW()', 'statusNote = ?'];
    const params = [status, note || null];

    if (timestampColumn) {
        updates.push(`${timestampColumn} = NOW()`);
    }

    if (status === 'cancelled') {
        updates.push('cancellationReason = ?');
        params.push(reason || null);
    }

    params.push(appointmentId);
    await connection.query(`UPDATE Appointments SET ${updates.join(', ')} WHERE id = ?`, params);
};

const canTransitionAppointment = (role, appt, nextStatus, userId) => {
    const currentStatus = appt.status;

    if (terminalAppointmentStatuses.includes(currentStatus)) {
        return { ok: false, message: 'Không thể cập nhật lịch hẹn đã kết thúc.' };
    }

    if (role === 'patient') {
        if (appt.patientId !== userId) {
            return { ok: false, message: 'Không thể cập nhật lịch của người khác.' };
        }
        const canCancel = nextStatus === 'cancelled' && ['pending', 'confirmed'].includes(currentStatus);
        return canCancel
            ? { ok: true }
            : { ok: false, message: 'Khách hàng chỉ được hủy lịch đang chờ xác nhận hoặc đã xác nhận.' };
    }

    if (role === 'dentist') {
        if (appt.dentistId !== userId) {
            return { ok: false, message: 'Chỉ được cập nhật lịch hẹn được phân công cho bạn.' };
        }
        if (currentStatus === 'arrived' && nextStatus === 'in_progress') {
            return { ok: true };
        }
        return { ok: false, message: 'Bác sĩ chỉ được bắt đầu khám khi khách đã được lễ tân check-in.' };
    }

    if (role === 'admin' || role === 'staff') {
        const allowedTransitions = {
            pending: ['confirmed', 'cancelled'],
            confirmed: ['arrived', 'cancelled', 'no_show'],
            arrived: ['cancelled'],
            in_progress: []
        };

        if ((allowedTransitions[currentStatus] || []).includes(nextStatus)) {
            return { ok: true };
        }

        return {
            ok: false,
            message: 'Trạng thái mới không đúng luồng xử lý lịch hẹn.'
        };
    }

    return { ok: false, message: 'Bạn không có quyền cập nhật trạng thái lịch hẹn.' };
};

const validateDentistAvailability = async (connection, dentistId, appointmentDate, appointmentTime, duration, excludeAppointmentId = null) => {
    const normalizedDate = normalizeDateValue(appointmentDate);
    const dayOfWeek = new Date(`${normalizedDate}T00:00:00`).getDay();
    const [[schedule]] = await connection.query(
        `SELECT startTime, endTime, breakStart, breakEnd, slotIntervalMinutes, isActive
         FROM DoctorSchedules
         WHERE dentistId = ? AND dayOfWeek = ?
         LIMIT 1`,
        [dentistId, dayOfWeek]
    );

    if (!schedule || Number(schedule.isActive) !== 1) {
        return 'Bác sĩ không làm việc trong ngày này.';
    }

    const [daysOff] = await connection.query(
        'SELECT id FROM DoctorDaysOff WHERE dentistId = ? AND offDate = ? LIMIT 1',
        [dentistId, normalizedDate]
    );
    if (daysOff.length > 0) {
        return 'Bác sĩ nghỉ trong ngày này.';
    }

    const start = timeToMinutes(appointmentTime);
    const end = start + duration;
    const workStart = timeToMinutes(schedule.startTime);
    const workEnd = timeToMinutes(schedule.endTime);
    const interval = Number(schedule.slotIntervalMinutes || 30);

    if (start < workStart || end > workEnd) {
        return 'Khung giờ khám nằm ngoài lịch làm việc của bác sĩ.';
    }

    if ((start - workStart) % interval !== 0) {
        return `Khung giờ phải theo bước ${interval} phút của lịch bác sĩ.`;
    }

    if (schedule.breakStart && schedule.breakEnd) {
        const breakStart = timeToMinutes(schedule.breakStart);
        const breakEnd = timeToMinutes(schedule.breakEnd);
        if (rangesOverlap(start, end, breakStart, breakEnd)) {
            return 'Khung giờ khám bị trùng giờ nghỉ của bác sĩ.';
        }
    }

    if (await hasAppointmentOverlap(connection, 'dentistId', dentistId, normalizedDate, start, duration, excludeAppointmentId)) {
        return 'Bác sĩ đã có lịch hẹn khác trong khoảng thời gian này.';
    }

    return null;
};

const appointmentController = {
    getAvailableSlots: async (req, res, next) => {
        try {
            const { date, dentistId } = req.query;
            const targetDentistId = Number(dentistId);
            const serviceIds = normalizeQueryServiceIds(req.query.serviceIds);
            const requestedDuration = await getServiceDuration(pool, serviceIds);
            const bookingLeadHours = await getBookingLeadHours(pool);

            if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
                return res.status(400).json({ success: false, message: 'Ngày khám không hợp lệ.' });
            }

            if (!Number.isInteger(targetDentistId) || targetDentistId <= 0) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn bác sĩ.' });
            }

            const [dentists] = await pool.query(
                'SELECT id FROM Users WHERE id = ? AND role = "dentist" AND status = "active"',
                [targetDentistId]
            );
            if (dentists.length === 0) {
                return res.status(404).json({ success: false, message: 'Bác sĩ không tồn tại hoặc đang bị khóa.' });
            }

            const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
            const [[schedule]] = await pool.query(
                `SELECT startTime, endTime, breakStart, breakEnd, slotIntervalMinutes, isActive
                 FROM DoctorSchedules
                 WHERE dentistId = ? AND dayOfWeek = ?
                 LIMIT 1`,
                [targetDentistId, dayOfWeek]
            );

            if (!schedule || Number(schedule.isActive) !== 1) {
                return res.json({
                    success: true,
                    message: 'Bác sĩ không làm việc trong ngày này.',
                    data: []
                });
            }

            const [daysOff] = await pool.query(
                'SELECT id FROM DoctorDaysOff WHERE dentistId = ? AND offDate = ? LIMIT 1',
                [targetDentistId, date]
            );
            if (daysOff.length > 0) {
                return res.json({
                    success: true,
                    message: 'Bác sĩ nghỉ trong ngày này.',
                    data: []
                });
            }

            const busyRanges = await getAppointmentBusyRanges(pool, 'dentistId', targetDentistId, date);

            const slots = [];
            const start = timeToMinutes(schedule.startTime);
            const end = timeToMinutes(schedule.endTime);
            const breakStart = schedule.breakStart ? timeToMinutes(schedule.breakStart) : null;
            const breakEnd = schedule.breakEnd ? timeToMinutes(schedule.breakEnd) : null;
            const interval = Number(schedule.slotIntervalMinutes || 30);

            for (let minutes = start; minutes < end; minutes += interval) {
                const time = minutesToTime(minutes);
                const slotEnd = minutes + requestedDuration;
                const outsideWorkingHours = slotEnd > end;
                const inBreak = breakStart !== null && breakEnd !== null && rangesOverlap(minutes, slotEnd, breakStart, breakEnd);
                const dateTime = new Date(`${date}T${time}:00`);
                const isPast = dateTime < getEarliestBookableDateTime(bookingLeadHours);
                const isBooked = busyRanges.some((range) => rangesOverlap(minutes, slotEnd, range.start, range.end));

                slots.push({
                    time,
                    duration: requestedDuration,
                    available: !isPast && !outsideWorkingHours && !isBooked && !inBreak,
                    reason: isPast ? 'past' : outsideWorkingHours ? 'outside_working_hours' : isBooked ? 'booked' : inBreak ? 'break' : null
                });
            }

            res.json({
                success: true,
                message: 'Lấy khung giờ trống thành công.',
                data: slots
            });
        } catch (error) {
            next(error);
        }
    },

    createAppointment: async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { dentistId, appointmentDate, appointmentTime, notes, serviceIds } = req.body;
            const normalizedServiceIds = normalizeServiceIds(serviceIds);

            let patientId = req.user.id;
            if (req.user.role === 'admin' || req.user.role === 'staff') {
                if (!req.body.patientId) {
                    throw new Error('Staff/Admin khi đặt lịch hộ cần cung cấp patientId.');
                }
                patientId = Number(req.body.patientId);
            }

            if (!appointmentDate || !appointmentTime || normalizedServiceIds.length === 0) {
                throw new Error('Vui lòng cung cấp ngày, giờ và ít nhất một dịch vụ.');
            }

            const appointmentDateTime = buildAppointmentDateTime(appointmentDate, appointmentTime);
            if (!appointmentDateTime) {
                throw new Error('Ngày hoặc giờ hẹn không hợp lệ.');
            }

            const bookingLeadHours = await getBookingLeadHours(connection);
            if (appointmentDateTime < getEarliestBookableDateTime(bookingLeadHours)) {
                throw new Error(`Cần đặt lịch trước ít nhất ${bookingLeadHours} giờ.`);
            }

            const [patients] = await connection.query(
                'SELECT id FROM Users WHERE id = ? AND role = "patient" AND status = "active"',
                [patientId]
            );
            if (patients.length === 0) {
                throw new Error('Bệnh nhân không tồn tại hoặc đang bị khóa.');
            }

            if (dentistId) {
                const [dentists] = await connection.query(
                    'SELECT id FROM Users WHERE id = ? AND role = "dentist" AND status = "active"',
                    [dentistId]
                );
                if (dentists.length === 0) {
                    throw new Error('Bác sĩ không tồn tại hoặc đang bị khóa.');
                }
            }

            const [validServices] = await connection.query(
                'SELECT id FROM Services WHERE id IN (?) AND status = "active"',
                [normalizedServiceIds]
            );
            if (validServices.length !== normalizedServiceIds.length) {
                throw new Error('Danh sách dịch vụ không hợp lệ hoặc có dịch vụ đã bị ẩn.');
            }

            const appointmentDuration = await getServiceDuration(connection, normalizedServiceIds);
            const startMinutes = timeToMinutes(appointmentTime);

            if (await hasAppointmentOverlap(connection, 'patientId', patientId, appointmentDate, startMinutes, appointmentDuration)) {
                throw new Error('Bệnh nhân đã có lịch hẹn khác trong khoảng thời gian này.');
            }

            if (dentistId) {
                const dentistAvailabilityError = await validateDentistAvailability(
                    connection,
                    Number(dentistId),
                    appointmentDate,
                    appointmentTime,
                    appointmentDuration
                );

                if (dentistAvailabilityError) {
                    throw new Error(dentistAvailabilityError);
                }
            }

            const [apptResult] = await connection.query(
                'INSERT INTO Appointments (patientId, dentistId, appointmentDate, appointmentTime, notes) VALUES (?, ?, ?, ?, ?)',
                [patientId, dentistId || null, appointmentDate, appointmentTime, notes || null]
            );
            const appointmentId = apptResult.insertId;
            await recordAppointmentStatusHistory(connection, appointmentId, null, 'pending', req.user.id, null, 'Tạo lịch hẹn');

            for (const serviceId of normalizedServiceIds) {
                await connection.query(
                    'INSERT INTO Appointment_Services (appointmentId, serviceId) VALUES (?, ?)',
                    [appointmentId, serviceId]
                );
            }

            await connection.commit();

            res.status(201).json({
                success: true,
                message: 'Đặt lịch hẹn thành công.',
                data: { appointmentId }
            });
        } catch (error) {
            await connection.rollback();
            if (isBusinessError(error.message)) {
                return res.status(400).json({ success: false, message: error.message });
            }
            next(error);
        } finally {
            connection.release();
        }
    },

    getAllAppointments: async (req, res, next) => {
        try {
            const role = req.user.role;
            const userId = req.user.id;

            let query = `
                SELECT 
                    a.id, a.patientId, a.dentistId, a.appointmentDate, a.appointmentTime, a.status, a.notes,
                    a.confirmationReminderSentAt, a.statusChangedAt, a.checkedInAt, a.startedAt, a.completedAt,
                    a.cancelledAt, a.noShowAt, a.cancellationReason, a.statusNote, a.rescheduledAt, a.rescheduleReason,
                    a.createdAt,
                    p.fullName as patientName, p.phone as patientPhone,
                    d.fullName as dentistName,
                    svc.serviceIds,
                    svc.serviceNames,
                    inv.id as invoiceId,
                    inv.status as invoiceStatus,
                    inv.totalAmount as invoiceTotalAmount
                FROM Appointments a
                JOIN Users p ON a.patientId = p.id
                LEFT JOIN Users d ON a.dentistId = d.id
                LEFT JOIN (
                    SELECT 
                        asv.appointmentId,
                        GROUP_CONCAT(s.id ORDER BY s.name SEPARATOR ',') as serviceIds,
                        GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') as serviceNames
                    FROM Appointment_Services asv
                    JOIN Services s ON asv.serviceId = s.id
                    GROUP BY asv.appointmentId
                ) svc ON svc.appointmentId = a.id
                LEFT JOIN Invoices inv ON inv.appointmentId = a.id
                WHERE 1=1
            `;
            const queryParams = [];

            if (role === 'patient') {
                query += ' AND a.patientId = ?';
                queryParams.push(userId);
            } else if (role === 'dentist') {
                query += ' AND a.dentistId = ?';
                queryParams.push(userId);
            }

            query += ' ORDER BY a.appointmentDate DESC, a.appointmentTime DESC';

            const [appointments] = await pool.query(query, queryParams);
            const normalizedAppointments = appointments.map((appointment) => ({
                ...appointment,
                serviceIds: appointment.serviceIds ? appointment.serviceIds.split(',').map((id) => Number(id)) : [],
                serviceNames: appointment.serviceNames || ''
            }));

            res.json({
                success: true,
                message: 'Lấy danh sách lịch hẹn thành công.',
                data: normalizedAppointments
            });
        } catch (error) {
            next(error);
        }
    },

    updateAppointmentStatus: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!validAppointmentStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ.' });
            }

            const [existing] = await pool.query('SELECT * FROM Appointments WHERE id = ?', [id]);
            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn.' });
            }

            const appt = existing[0];

            if (appt.status === status) {
                return res.json({ success: true, message: 'Trạng thái lịch hẹn không thay đổi.' });
            }

            if (['completed', 'cancelled'].includes(appt.status)) {
                return res.status(400).json({ success: false, message: 'Không thể cập nhật lịch hẹn đã hoàn thành hoặc đã hủy.' });
            }

            if (req.user.role === 'patient') {
                if (status !== 'cancelled') {
                    return res.status(403).json({ success: false, message: 'Khách hàng chỉ được phép hủy lịch hẹn.' });
                }
                if (appt.patientId !== req.user.id) {
                    return res.status(403).json({ success: false, message: 'Không thể hủy lịch của người khác.' });
                }
                if (!['pending', 'confirmed'].includes(appt.status)) {
                    return res.status(400).json({ success: false, message: 'Chỉ có thể hủy lịch đang chờ xác nhận hoặc đã xác nhận.' });
                }
            } else if (req.user.role === 'dentist') {
                if (appt.dentistId !== req.user.id) {
                    return res.status(403).json({ success: false, message: 'Chỉ được cập nhật lịch hẹn được phân công cho bạn.' });
                }
                return res.status(403).json({ success: false, message: 'Bác sĩ hoàn tất lịch hẹn bằng cách lưu hồ sơ khám.' });
            } else if (req.user.role === 'admin' || req.user.role === 'staff') {
                const canConfirm = appt.status === 'pending' && status === 'confirmed';
                const canCancel = ['pending', 'confirmed'].includes(appt.status) && status === 'cancelled';

                if (!canConfirm && !canCancel) {
                    return res.status(400).json({
                        success: false,
                        message: 'Nhân viên chỉ được xác nhận lịch đang chờ hoặc hủy lịch đang chờ/đã xác nhận.'
                    });
                }

                if (status === 'confirmed' && !appt.dentistId) {
                    return res.status(400).json({ success: false, message: 'Cần phân công bác sĩ trước khi xác nhận lịch hẹn.' });
                }
            } else {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền cập nhật trạng thái lịch hẹn.' });
            }

            await pool.query('UPDATE Appointments SET status = ? WHERE id = ?', [status, id]);

            if (status === 'confirmed') {
                await createNotification(
                    pool,
                    appt.patientId,
                    'Lịch hẹn đã được xác nhận',
                    `Lịch hẹn #${id} của bạn đã được xác nhận.`,
                    'appointment'
                );
            }

            res.json({
                success: true,
                message: 'Đã cập nhật trạng thái lịch hẹn.'
            });
        } catch (error) {
            next(error);
        }
    },

    updateAppointmentStatus: async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const { status, reason, note } = req.body;

            if (!validAppointmentStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ.' });
            }

            await connection.beginTransaction();

            const [existing] = await connection.query('SELECT * FROM Appointments WHERE id = ? FOR UPDATE', [id]);
            if (existing.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn.' });
            }

            const appt = existing[0];
            if (appt.status === status) {
                await connection.rollback();
                return res.json({ success: true, message: 'Trạng thái lịch hẹn không thay đổi.' });
            }

            if (status === 'confirmed' && !appt.dentistId) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Cần phân công bác sĩ trước khi xác nhận lịch hẹn.' });
            }

            const transition = canTransitionAppointment(req.user.role, appt, status, req.user.id);
            if (!transition.ok) {
                await connection.rollback();
                return res.status(req.user.role === 'patient' || req.user.role === 'dentist' ? 403 : 400).json({
                    success: false,
                    message: transition.message
                });
            }

            await updateAppointmentStatusFields(connection, id, status, { reason, note });
            await recordAppointmentStatusHistory(connection, id, appt.status, status, req.user.id, reason, note);

            if (status === 'confirmed') {
                await createNotification(
                    connection,
                    appt.patientId,
                    'Lịch hẹn đã được xác nhận',
                    `Lịch hẹn #${id} của bạn đã được xác nhận.`,
                    'appointment'
                );
            }

            if (status === 'arrived' && appt.dentistId) {
                await createNotification(
                    connection,
                    appt.dentistId,
                    'Khách hàng đã đến phòng khám',
                    `Khách hàng của lịch hẹn #${id} đã được lễ tân check-in.`,
                    'appointment'
                );
            }

            if (status === 'cancelled') {
                await createNotification(
                    connection,
                    appt.patientId,
                    'Lịch hẹn đã bị hủy',
                    `Lịch hẹn #${id} đã bị hủy${reason ? `: ${reason}` : '.'}`,
                    'appointment'
                );
            }

            await connection.commit();

            res.json({
                success: true,
                message: `Đã chuyển lịch hẹn sang trạng thái "${statusLabels[status] || status}".`
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    assignDentist: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { dentistId } = req.body;

            if (!dentistId) {
                return res.status(400).json({ success: false, message: 'Vui lòng cung cấp dentistId.' });
            }

            const [dentist] = await pool.query(
                'SELECT id FROM Users WHERE id = ? AND role = "dentist" AND status = "active"',
                [dentistId]
            );
            if (dentist.length === 0) {
                return res.status(404).json({ success: false, message: 'Bác sĩ không tồn tại hoặc đang bị khóa.' });
            }

            const [existing] = await pool.query(
                'SELECT id, patientId, dentistId, appointmentDate, appointmentTime, status FROM Appointments WHERE id = ?',
                [id]
            );
            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn.' });
            }

            const appt = existing[0];
            if (!['pending', 'confirmed'].includes(appt.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Chỉ có thể phân công bác sĩ cho lịch đang chờ hoặc đã xác nhận.'
                });
            }

            if (req.user.role === 'staff' && appt.status === 'confirmed') {
                const [pendingRequests] = await pool.query(
                    'SELECT id FROM DentistChangeRequests WHERE appointmentId = ? AND status = "pending" LIMIT 1',
                    [id]
                );
                if (pendingRequests.length > 0) {
                    return res.status(409).json({ success: false, message: 'Lịch hẹn này đã có yêu cầu đổi bác sĩ đang chờ duyệt.' });
                }

                const [requestResult] = await pool.query(
                    `INSERT INTO DentistChangeRequests (appointmentId, requestedBy, oldDentistId, newDentistId, note)
                     VALUES (?, ?, ?, ?, ?)`,
                    [id, req.user.id, appt.dentistId || null, dentistId, req.body.note || null]
                );

                await createNotificationsForRoles(
                    pool,
                    ['admin'],
                    'Yêu cầu đổi bác sĩ',
                    `Lễ tân yêu cầu đổi bác sĩ cho lịch hẹn #${id}.`,
                    'appointment'
                );

                return res.status(202).json({
                    success: true,
                    message: 'Đã gửi yêu cầu đổi bác sĩ, chờ admin duyệt.',
                    data: { requestId: requestResult.insertId }
                });
            }

            const [serviceRows] = await pool.query(
                'SELECT serviceId FROM Appointment_Services WHERE appointmentId = ?',
                [id]
            );
            const appointmentDuration = await getServiceDuration(pool, serviceRows.map((row) => row.serviceId));
            const dentistAvailabilityError = await validateDentistAvailability(
                pool,
                Number(dentistId),
                appt.appointmentDate,
                appt.appointmentTime,
                appointmentDuration,
                id
            );

            if (dentistAvailabilityError) {
                return res.status(400).json({
                    success: false,
                    message: dentistAvailabilityError
                });
            }

            await pool.query('UPDATE Appointments SET dentistId = ? WHERE id = ?', [dentistId, id]);

            await createNotification(
                pool,
                appt.patientId,
                'Bác sĩ phụ trách đã được cập nhật',
                `Lịch hẹn #${id} đã được phân công bác sĩ phụ trách.`,
                'appointment'
            );

            res.json({
                success: true,
                message: 'Đã phân công bác sĩ thành công.'
            });
        } catch (error) {
            next(error);
        }
    },

    rescheduleAppointment: async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const appointmentId = Number(req.params.id);
            const { appointmentDate, appointmentTime, reason, note } = req.body;

            if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
                return res.status(400).json({ success: false, message: 'ID lịch hẹn không hợp lệ.' });
            }

            const appointmentDateTime = buildAppointmentDateTime(appointmentDate, appointmentTime);
            if (!appointmentDateTime) {
                return res.status(400).json({ success: false, message: 'Ngày hoặc giờ hẹn mới không hợp lệ.' });
            }

            await connection.beginTransaction();

            const [existing] = await connection.query(
                'SELECT * FROM Appointments WHERE id = ? FOR UPDATE',
                [appointmentId]
            );
            if (existing.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn.' });
            }

            const appt = existing[0];
            if (!['pending', 'confirmed'].includes(appt.status)) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Chỉ có thể dời lịch đang chờ xác nhận hoặc đã xác nhận.' });
            }

            if (req.user.role === 'patient') {
                if (appt.patientId !== req.user.id) {
                    await connection.rollback();
                    return res.status(403).json({ success: false, message: 'Không thể dời lịch của người khác.' });
                }
            } else if (!['admin', 'staff'].includes(req.user.role)) {
                await connection.rollback();
                return res.status(403).json({ success: false, message: 'Bạn không có quyền dời lịch hẹn.' });
            }

            const bookingLeadHours = await getBookingLeadHours(connection);
            if (appointmentDateTime < getEarliestBookableDateTime(bookingLeadHours)) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: `Cần đặt lịch trước ít nhất ${bookingLeadHours} giờ.` });
            }

            const [serviceRows] = await connection.query(
                'SELECT serviceId FROM Appointment_Services WHERE appointmentId = ?',
                [appointmentId]
            );
            const serviceIds = serviceRows.map((row) => row.serviceId);
            const appointmentDuration = await getServiceDuration(connection, serviceIds);
            const startMinutes = timeToMinutes(appointmentTime);

            if (await hasAppointmentOverlap(connection, 'patientId', appt.patientId, appointmentDate, startMinutes, appointmentDuration, appointmentId)) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Bệnh nhân đã có lịch khác trong khoảng thời gian này.' });
            }

            if (appt.dentistId) {
                const availabilityError = await validateDentistAvailability(
                    connection,
                    appt.dentistId,
                    appointmentDate,
                    appointmentTime,
                    appointmentDuration,
                    appointmentId
                );

                if (availabilityError) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: availabilityError });
                }
            }

            await connection.query(
                `UPDATE Appointments
                 SET appointmentDate = ?, appointmentTime = ?, rescheduledAt = NOW(), rescheduleReason = ?, statusNote = ?
                 WHERE id = ?`,
                [appointmentDate, appointmentTime, reason || null, note || null, appointmentId]
            );

            await recordAppointmentStatusHistory(
                connection,
                appointmentId,
                appt.status,
                appt.status,
                req.user.id,
                reason || 'Dời lịch',
                `Dời từ ${normalizeDateValue(appt.appointmentDate)} ${String(appt.appointmentTime).slice(0, 5)} sang ${appointmentDate} ${String(appointmentTime).slice(0, 5)}${note ? `. ${note}` : ''}`
            );

            await createNotification(
                connection,
                appt.patientId,
                'Lịch hẹn đã được dời',
                `Lịch hẹn #${appointmentId} đã được dời sang ${appointmentDate} ${String(appointmentTime).slice(0, 5)}.`,
                'appointment'
            );

            if (appt.dentistId) {
                await createNotification(
                    connection,
                    appt.dentistId,
                    'Lịch hẹn đã được dời',
                    `Lịch hẹn #${appointmentId} đã được dời sang ${appointmentDate} ${String(appointmentTime).slice(0, 5)}.`,
                    'appointment'
                );
            }

            await connection.commit();
            res.json({ success: true, message: 'Đã dời lịch hẹn thành công.' });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    getDentistChangeRequests: async (req, res, next) => {
        try {
            const [rows] = await pool.query(`
                SELECT r.*, 
                       a.appointmentDate, a.appointmentTime,
                       p.fullName as patientName,
                       requester.fullName as requestedByName,
                       oldDentist.fullName as oldDentistName,
                       newDentist.fullName as newDentistName,
                       admin.fullName as adminName
                FROM DentistChangeRequests r
                JOIN Appointments a ON a.id = r.appointmentId
                JOIN Users p ON p.id = a.patientId
                JOIN Users requester ON requester.id = r.requestedBy
                LEFT JOIN Users oldDentist ON oldDentist.id = r.oldDentistId
                JOIN Users newDentist ON newDentist.id = r.newDentistId
                LEFT JOIN Users admin ON admin.id = r.adminId
                ORDER BY r.createdAt DESC
                LIMIT 100
            `);

            res.json({ success: true, message: 'Lấy yêu cầu đổi bác sĩ thành công.', data: rows });
        } catch (error) {
            next(error);
        }
    },

    reviewDentistChangeRequest: async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const requestId = Number(req.params.requestId);
            const { status } = req.body;

            if (!Number.isInteger(requestId) || requestId <= 0) {
                return res.status(400).json({ success: false, message: 'ID yêu cầu không hợp lệ.' });
            }

            if (!['approved', 'rejected'].includes(status)) {
                return res.status(400).json({ success: false, message: 'Trạng thái duyệt không hợp lệ.' });
            }

            await connection.beginTransaction();

            const [requests] = await connection.query(
                `SELECT r.*, a.patientId, a.appointmentDate, a.appointmentTime, a.status as appointmentStatus
                 FROM DentistChangeRequests r
                 JOIN Appointments a ON a.id = r.appointmentId
                 WHERE r.id = ?
                 FOR UPDATE`,
                [requestId]
            );

            if (requests.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu đổi bác sĩ.' });
            }

            const request = requests[0];
            if (request.status !== 'pending') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Yêu cầu này đã được xử lý.' });
            }

            if (status === 'approved') {
                if (request.appointmentStatus !== 'confirmed') {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Chỉ duyệt đổi bác sĩ cho lịch đã xác nhận.' });
                }

                const [serviceRows] = await connection.query(
                    'SELECT serviceId FROM Appointment_Services WHERE appointmentId = ?',
                    [request.appointmentId]
                );
                const appointmentDuration = await getServiceDuration(connection, serviceRows.map((row) => row.serviceId));
                const availabilityError = await validateDentistAvailability(
                    connection,
                    request.newDentistId,
                    request.appointmentDate,
                    request.appointmentTime,
                    appointmentDuration,
                    request.appointmentId
                );

                if (availabilityError) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: availabilityError });
                }

                await connection.query(
                    'UPDATE Appointments SET dentistId = ? WHERE id = ?',
                    [request.newDentistId, request.appointmentId]
                );
            }

            await connection.query(
                'UPDATE DentistChangeRequests SET status = ?, adminId = ?, reviewedAt = NOW() WHERE id = ?',
                [status, req.user.id, requestId]
            );

            await createNotification(
                connection,
                request.requestedBy,
                status === 'approved' ? 'Yêu cầu đổi bác sĩ đã được duyệt' : 'Yêu cầu đổi bác sĩ bị từ chối',
                `Yêu cầu đổi bác sĩ cho lịch hẹn #${request.appointmentId} đã được ${status === 'approved' ? 'duyệt' : 'từ chối'}.`,
                'appointment'
            );

            if (status === 'approved') {
                await createNotification(
                    connection,
                    request.patientId,
                    'Bác sĩ phụ trách đã được cập nhật',
                    `Lịch hẹn #${request.appointmentId} đã được đổi bác sĩ phụ trách.`,
                    'appointment'
                );
            }

            await connection.commit();
            res.json({ success: true, message: 'Đã xử lý yêu cầu đổi bác sĩ.' });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    }
};

module.exports = appointmentController;
