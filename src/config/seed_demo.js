const bcrypt = require('bcryptjs');

const demoUsers = [
    {
        fullName: 'Admin Phenikaa',
        email: 'admin@doan1.local',
        password: 'Admin@123',
        phone: '0900000001',
        role: 'admin'
    },
    {
        fullName: 'Nhân viên lễ tân',
        email: 'staff@doan1.local',
        password: 'Staff@123',
        phone: '0900000002',
        role: 'staff'
    },
    {
        fullName: 'Nguyễn Minh Anh',
        email: 'dentist@doan1.local',
        password: 'Dentist@123',
        phone: '0900000003',
        role: 'dentist'
    },
    {
        fullName: 'Nguyễn Tùng Ninh',
        email: 'patient@doan1.local',
        password: 'Patient@123',
        phone: '0900000004',
        role: 'patient'
    }
];

const demoCategories = [
    ['Nha khoa tổng quát', 'Khám, tư vấn và chăm sóc răng miệng định kỳ.'],
    ['Thẩm mỹ nụ cười', 'Tẩy trắng, răng sứ và cải thiện thẩm mỹ hàm răng.'],
    ['Chỉnh nha', 'Niềng răng và điều chỉnh khớp cắn.'],
    ['Implant', 'Phục hồi răng mất bằng trụ Implant.']
];

const demoServices = [
    {
        name: 'Khám và tư vấn nha khoa',
        description: 'Kiểm tra tổng quát, tư vấn kế hoạch điều trị phù hợp.',
        price: 150000,
        duration: 30,
        categoryName: 'Nha khoa tổng quát'
    },
    {
        name: 'Cạo vôi răng',
        description: 'Làm sạch mảng bám, hỗ trợ phòng ngừa viêm nướu.',
        price: 300000,
        duration: 45,
        categoryName: 'Nha khoa tổng quát'
    },
    {
        name: 'Tẩy trắng răng',
        description: 'Cải thiện màu răng bằng công nghệ tẩy trắng an toàn.',
        price: 1500000,
        duration: 60,
        categoryName: 'Thẩm mỹ nụ cười'
    },
    {
        name: 'Răng sứ thẩm mỹ',
        description: 'Phục hình răng sứ tự nhiên, hài hòa với nụ cười.',
        price: 4500000,
        duration: 90,
        categoryName: 'Thẩm mỹ nụ cười'
    },
    {
        name: 'Niềng răng chỉnh nha',
        description: 'Điều chỉnh răng lệch lạc, sai khớp cắn.',
        price: 25000000,
        duration: 60,
        categoryName: 'Chỉnh nha'
    },
    {
        name: 'Cấy ghép Implant',
        description: 'Phục hồi răng mất bằng Implant chắc khỏe, bền vững.',
        price: 18000000,
        duration: 120,
        categoryName: 'Implant'
    }
];

const demoSettings = {
    clinicName: 'Phenikaa Dental',
    phone: '0869 800 318',
    email: 'contact@phenikaadental.vn',
    address: 'Tòa nhà Phenikaa Tower, Hà Đông, Hà Nội',
    openingHours: '08:00 - 20:00',
    mapUrl: '',
    facebookUrl: '',
    zaloPhone: '0869 800 318',
    bookingLeadHours: '24',
    appointmentReminderHours: '4',
    cancellationLeadHours: '6',
    rescheduleLeadHours: '12',
    autoNoShowMinutes: '30',
    maxServicesPerAppointment: '4',
    slotIntervalMinutes: '30',
    maintenanceMode: 'false',
    allowOnlineBooking: 'true',
    allowPatientCancellation: 'true',
    allowPatientReschedule: 'true',
    notifyStaffOnNewAppointment: 'true',
    notifyPatientOnStatusChange: 'true',
    theme: 'light'
};

const toDate = (date) => date.toISOString().slice(0, 10);

const demoPromotions = () => {
    const start = new Date();
    start.setDate(start.getDate() - 7);

    const end = new Date();
    end.setDate(end.getDate() + 30);

    return [
        {
            name: 'Ưu đãi khám tổng quát',
            description: 'Giảm 20% dịch vụ khám và cạo vôi răng cho khách hàng đặt lịch online.',
            discountPercent: 20,
            startDate: toDate(start),
            endDate: toDate(end),
            isActive: 1
        },
        {
            name: 'Tư vấn Implant miễn phí',
            description: 'Miễn phí tư vấn kế hoạch điều trị Implant trong tháng.',
            discountPercent: 10,
            startDate: toDate(start),
            endDate: toDate(end),
            isActive: 1
        }
    ];
};

const seedUsers = async (connection) => {
    for (const user of demoUsers) {
        const hashedPassword = await bcrypt.hash(user.password, 10);

        await connection.query(
            `INSERT INTO Users (fullName, email, password, phone, role, status)
             VALUES (?, ?, ?, ?, ?, "active")
             ON DUPLICATE KEY UPDATE
                fullName = VALUES(fullName),
                password = VALUES(password),
                phone = VALUES(phone),
                role = VALUES(role),
                status = "active"`,
            [user.fullName, user.email, hashedPassword, user.phone, user.role]
        );
    }
};

const seedCategories = async (connection) => {
    for (const [name, description] of demoCategories) {
        await connection.query(
            `INSERT INTO Categories (name, description)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE description = VALUES(description)`,
            [name, description]
        );
    }
};

const getCategoryId = async (connection, name) => {
    const [rows] = await connection.query('SELECT id FROM Categories WHERE name = ? LIMIT 1', [name]);
    return rows.length > 0 ? rows[0].id : null;
};

const seedServices = async (connection) => {
    for (const service of demoServices) {
        const categoryId = await getCategoryId(connection, service.categoryName);
        const [existing] = await connection.query('SELECT id FROM Services WHERE name = ? LIMIT 1', [service.name]);

        if (existing.length > 0) {
            await connection.query(
                `UPDATE Services
                 SET description = ?, price = ?, duration = ?, categoryId = ?, status = "active"
                 WHERE id = ?`,
                [service.description, service.price, service.duration, categoryId, existing[0].id]
            );
            continue;
        }

        await connection.query(
            `INSERT INTO Services (name, description, price, duration, categoryId, status)
             VALUES (?, ?, ?, ?, ?, "active")`,
            [service.name, service.description, service.price, service.duration, categoryId]
        );
    }
};

const seedDoctorSchedules = async (connection) => {
    const [dentists] = await connection.query('SELECT id FROM Users WHERE role = "dentist" AND status = "active"');

    for (const dentist of dentists) {
        for (const dayOfWeek of [1, 2, 3, 4, 5, 6, 0]) {
            await connection.query(
                `INSERT INTO DoctorSchedules
                    (dentistId, dayOfWeek, startTime, endTime, breakStart, breakEnd, slotIntervalMinutes, isActive)
                 VALUES (?, ?, "08:00:00", "17:00:00", "12:00:00", "13:00:00", 30, 1)
                 ON DUPLICATE KEY UPDATE
                    startTime = VALUES(startTime),
                    endTime = VALUES(endTime),
                    breakStart = VALUES(breakStart),
                    breakEnd = VALUES(breakEnd),
                    slotIntervalMinutes = VALUES(slotIntervalMinutes),
                    isActive = VALUES(isActive)`,
                [dentist.id, dayOfWeek]
            );
        }
    }
};

const seedSettings = async (connection) => {
    for (const [key, value] of Object.entries(demoSettings)) {
        await connection.query(
            `INSERT INTO Settings (settingKey, settingValue)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
            [key, value]
        );
    }
};

const seedPromotions = async (connection) => {
    for (const promotion of demoPromotions()) {
        const [existing] = await connection.query('SELECT id FROM Promotions WHERE name = ? LIMIT 1', [promotion.name]);

        if (existing.length > 0) {
            await connection.query(
                `UPDATE Promotions
                 SET description = ?, discountPercent = ?, startDate = ?, endDate = ?, isActive = ?
                 WHERE id = ?`,
                [
                    promotion.description,
                    promotion.discountPercent,
                    promotion.startDate,
                    promotion.endDate,
                    promotion.isActive,
                    existing[0].id
                ]
            );
            continue;
        }

        await connection.query(
            `INSERT INTO Promotions (name, description, discountPercent, startDate, endDate, isActive)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                promotion.name,
                promotion.description,
                promotion.discountPercent,
                promotion.startDate,
                promotion.endDate,
                promotion.isActive
            ]
        );
    }
};

const seedDemoData = async (connection) => {
    await seedUsers(connection);
    await seedCategories(connection);
    await seedServices(connection);
    await seedDoctorSchedules(connection);
    await seedSettings(connection);
    await seedPromotions(connection);
};

module.exports = {
    seedDemoData,
    demoUsers
};
