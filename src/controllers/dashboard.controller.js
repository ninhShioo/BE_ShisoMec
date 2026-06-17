const pool = require('../config/database');

const formatDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const buildLast7Days = (revenueByDate) => {
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);

        const dateKey = formatDateKey(date);
        const [, month, day] = dateKey.split('-');

        days.push({
            name: `${day}/${month}`,
            revenue: Number(revenueByDate.get(dateKey) || 0)
        });
    }

    return days;
};

const buildCurrentYearMonths = (revenueByMonth) => {
    const months = [];
    const currentYear = new Date().getFullYear();

    for (let month = 1; month <= 12; month += 1) {
        const key = `${currentYear}-${String(month).padStart(2, '0')}`;
        months.push({
            name: `T${month}`,
            revenue: Number(revenueByMonth.get(key) || 0)
        });
    }

    return months;
};

const buildLast8Weeks = (revenueByWeek) => {
    const weeks = [];
    const today = new Date();

    for (let i = 7; i >= 0; i -= 1) {
        const date = new Date(today);
        date.setDate(today.getDate() - i * 7);
        const { year, week } = getWeekInfo(date);
        const key = `${year}-${String(week).padStart(2, '0')}`;

        weeks.push({
            name: `T${week}`,
            revenue: Number(revenueByWeek.get(key) || 0)
        });
    }

    return weeks;
};

const getWeekInfo = (date) => {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return {
        year: target.getUTCFullYear(),
        week: Math.ceil((((target - yearStart) / 86400000) + 1) / 7)
    };
};

const buildLast5Years = (revenueByYear) => {
    const years = [];
    const currentYear = new Date().getFullYear();

    for (let year = currentYear - 4; year <= currentYear; year += 1) {
        years.push({
            name: String(year),
            revenue: Number(revenueByYear.get(String(year)) || 0)
        });
    }

    return years;
};

const dashboardController = {
    getWorkspaceSummary: async (req, res, next) => {
        try {
            const role = req.user.role;
            const userId = req.user.id;
            const message = 'Lấy tổng quan khu làm việc thành công.';

            if (role === 'dentist') {
                const [[todayRows], [pendingRows], [completedRows], [nextRows]] = await Promise.all([
                    pool.query(
                        `SELECT COUNT(*) as total
                         FROM Appointments
                         WHERE dentistId = ? AND appointmentDate = CURDATE() AND status IN ("confirmed", "completed")`,
                        [userId]
                    ),
                    pool.query(
                        `SELECT COUNT(*) as total
                         FROM Appointments
                         WHERE dentistId = ? AND status = "confirmed"`,
                        [userId]
                    ),
                    pool.query(
                        `SELECT COUNT(*) as total
                         FROM Appointments
                         WHERE dentistId = ? AND status = "completed"`,
                        [userId]
                    ),
                    pool.query(
                        `SELECT COUNT(*) as total
                         FROM Appointments
                         WHERE dentistId = ?
                         AND status = "confirmed"
                         AND TIMESTAMP(appointmentDate, appointmentTime) BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)`,
                        [userId]
                    )
                ]);

                return res.json({
                    success: true,
                    message,
                    data: [
                        { label: 'Lịch hôm nay', value: Number(todayRows[0]?.total || 0), helper: 'Ca khám trong ngày', tone: 'blue' },
                        { label: 'Sắp đến', value: Number(nextRows[0]?.total || 0), helper: 'Ca confirmed trong 24h', tone: 'amber' },
                        { label: 'Chờ ghi hồ sơ', value: Number(pendingRows[0]?.total || 0), helper: 'Cần hoàn tất sau khám', tone: 'emerald' },
                        { label: 'Đã hoàn thành', value: Number(completedRows[0]?.total || 0), helper: 'Tổng ca đã hoàn tất', tone: 'slate' }
                    ]
                });
            }

            if (role === 'staff') {
                const [[pendingRows], [confirmedRows], [invoiceRows], [dueSoonRows], [chatRows]] = await Promise.all([
                    pool.query('SELECT COUNT(*) as total FROM Appointments WHERE status = "pending"'),
                    pool.query('SELECT COUNT(*) as total FROM Appointments WHERE status = "confirmed"'),
                    pool.query('SELECT COUNT(*) as total FROM Invoices WHERE status = "unpaid"'),
                    pool.query(`
                        SELECT COUNT(*) as total
                        FROM Appointments
                        WHERE status = "pending"
                        AND TIMESTAMP(appointmentDate, appointmentTime) BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 4 HOUR)
                    `),
                    pool.query(`
                        SELECT COUNT(*) as total
                        FROM ChatMessages c
                        JOIN Users u ON u.id = c.senderId
                        WHERE u.role = "patient" AND c.receiverId IS NULL AND c.readAt IS NULL
                    `)
                ]);

                return res.json({
                    success: true,
                    message,
                    data: [
                        { label: 'Lịch chờ xác nhận', value: Number(pendingRows[0]?.total || 0), helper: 'Cần gọi xác nhận', tone: 'amber' },
                        { label: 'Sắp đến chưa xác nhận', value: Number(dueSoonRows[0]?.total || 0), helper: 'Trong 4 giờ tới', tone: 'rose' },
                        { label: 'Lịch đã xác nhận', value: Number(confirmedRows[0]?.total || 0), helper: 'Đang chờ khám', tone: 'blue' },
                        { label: 'Hóa đơn chưa thu', value: Number(invoiceRows[0]?.total || 0), helper: 'Cần xử lý thanh toán', tone: 'emerald' },
                        { label: 'Chat chưa đọc', value: Number(chatRows[0]?.total || 0), helper: 'Tin khách gửi', tone: 'cyan' }
                    ]
                });
            }

            if (role === 'admin') {
                const [[patientRows], [dentistRows], [revenueRows], [reviewRows], [changeRows], [pendingRows]] = await Promise.all([
                    pool.query('SELECT COUNT(*) as total FROM Users WHERE role = "patient"'),
                    pool.query('SELECT COUNT(*) as total FROM Users WHERE role = "dentist" AND status = "active"'),
                    pool.query('SELECT COALESCE(SUM(totalAmount), 0) as total FROM Invoices WHERE status = "paid"'),
                    pool.query('SELECT COUNT(*) as total FROM Reviews WHERE status = "pending"'),
                    pool.query('SELECT COUNT(*) as total FROM DentistChangeRequests WHERE status = "pending"'),
                    pool.query('SELECT COUNT(*) as total FROM Appointments WHERE status = "pending"')
                ]);

                return res.json({
                    success: true,
                    message,
                    data: [
                        { label: 'Bệnh nhân', value: Number(patientRows[0]?.total || 0), helper: 'Tài khoản khách', tone: 'blue' },
                        { label: 'Bác sĩ active', value: Number(dentistRows[0]?.total || 0), helper: 'Có thể nhận lịch', tone: 'emerald' },
                        { label: 'Lịch chờ xác nhận', value: Number(pendingRows[0]?.total || 0), helper: 'Cần lễ tân xử lý', tone: 'amber' },
                        { label: 'Đánh giá chờ duyệt', value: Number(reviewRows[0]?.total || 0), helper: 'Review public', tone: 'rose' },
                        { label: 'Yêu cầu đổi bác sĩ', value: Number(changeRows[0]?.total || 0), helper: 'Chờ admin duyệt', tone: 'violet' },
                        { label: 'Doanh thu đã thu', value: Number(revenueRows[0]?.total || 0), currency: true, helper: 'Tổng hóa đơn paid', tone: 'slate' }
                    ]
                });
            }

            return res.status(403).json({ success: false, message: 'Bạn không có quyền xem tổng quan này.' });
        } catch (error) {
            next(error);
        }
    },

    getSummary: async (req, res, next) => {
        try {
            const [
                [userStatsRows],
                [todayAppointmentRows],
                [monthlyRevenueRows],
                [revenueRows],
                [weeklyRevenueRows],
                [monthlyRevenueChartRows],
                [yearlyRevenueRows],
                [serviceUsageRows],
                [activityLogRows]
            ] = await Promise.all([
                pool.query(`
                    SELECT
                        SUM(role = "patient") as totalPatients,
                        SUM(role = "dentist") as totalDentists
                    FROM Users
                `),
                pool.query(`
                    SELECT COUNT(*) as todayAppointments
                    FROM Appointments
                    WHERE appointmentDate = CURDATE()
                `),
                pool.query(`
                    SELECT COALESCE(SUM(amount), 0) as monthlyRevenue
                    FROM Payments
                    WHERE status = "success"
                    AND YEAR(createdAt) = YEAR(CURDATE())
                    AND MONTH(createdAt) = MONTH(CURDATE())
                `),
                pool.query(`
                    SELECT DATE_FORMAT(p.createdAt, "%Y-%m-%d") as revenueDate,
                           COALESCE(SUM(p.amount), 0) as revenue
                    FROM Payments p
                    WHERE p.status = "success"
                    AND DATE(p.createdAt) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                    GROUP BY DATE_FORMAT(p.createdAt, "%Y-%m-%d")
                    ORDER BY revenueDate
                `),
                pool.query(`
                    SELECT DATE_FORMAT(p.createdAt, "%x-%v") as revenueWeek,
                           COALESCE(SUM(p.amount), 0) as revenue
                    FROM Payments p
                    WHERE p.status = "success"
                    AND DATE(p.createdAt) >= DATE_SUB(CURDATE(), INTERVAL 7 WEEK)
                    GROUP BY DATE_FORMAT(p.createdAt, "%x-%v")
                    ORDER BY revenueWeek
                `),
                pool.query(`
                    SELECT DATE_FORMAT(p.createdAt, "%Y-%m") as revenueMonth,
                           COALESCE(SUM(p.amount), 0) as revenue
                    FROM Payments p
                    WHERE p.status = "success"
                    AND YEAR(p.createdAt) = YEAR(CURDATE())
                    GROUP BY DATE_FORMAT(p.createdAt, "%Y-%m")
                    ORDER BY revenueMonth
                `),
                pool.query(`
                    SELECT DATE_FORMAT(p.createdAt, "%Y") as revenueYear,
                           COALESCE(SUM(p.amount), 0) as revenue
                    FROM Payments p
                    WHERE p.status = "success"
                    AND YEAR(p.createdAt) >= YEAR(CURDATE()) - 4
                    GROUP BY DATE_FORMAT(p.createdAt, "%Y")
                    ORDER BY revenueYear
                `),
                pool.query(`
                    SELECT s.name, COUNT(asv.serviceId) as value
                    FROM Services s
                    LEFT JOIN Appointment_Services asv ON s.id = asv.serviceId
                    GROUP BY s.id, s.name
                    HAVING value > 0
                    ORDER BY value DESC
                    LIMIT 8
                `),
                pool.query(`
                    SELECT
                        a.id, a.action, a.entity, a.entityId, a.createdAt, a.ipAddress,
                        u.fullName as userName, u.role as userRole
                    FROM ActivityLogs a
                    LEFT JOIN Users u ON a.userId = u.id
                    ORDER BY a.createdAt DESC
                    LIMIT 5
                `)
            ]);

            const revenueByDate = new Map(
                revenueRows.map((row) => [row.revenueDate, Number(row.revenue)])
            );
            const revenueByMonth = new Map(
                monthlyRevenueChartRows.map((row) => [row.revenueMonth, Number(row.revenue)])
            );
            const revenueByWeek = new Map(
                weeklyRevenueRows.map((row) => [row.revenueWeek, Number(row.revenue)])
            );
            const revenueByYear = new Map(
                yearlyRevenueRows.map((row) => [row.revenueYear, Number(row.revenue)])
            );

            res.json({
                success: true,
                message: 'Lấy thống kê dashboard thành công.',
                data: {
                    stats: {
                        totalPatients: Number(userStatsRows[0]?.totalPatients || 0),
                        totalDentists: Number(userStatsRows[0]?.totalDentists || 0),
                        todayAppointments: Number(todayAppointmentRows[0]?.todayAppointments || 0),
                        monthlyRevenue: Number(monthlyRevenueRows[0]?.monthlyRevenue || 0)
                    },
                    revenueData: buildLast7Days(revenueByDate),
                    weeklyRevenueData: buildLast8Weeks(revenueByWeek),
                    monthlyRevenueData: buildCurrentYearMonths(revenueByMonth),
                    yearlyRevenueData: buildLast5Years(revenueByYear),
                    serviceUsage: serviceUsageRows.map((row) => ({
                        name: row.name,
                        value: Number(row.value)
                    })),
                    activityLogs: activityLogRows
                }
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = dashboardController;
