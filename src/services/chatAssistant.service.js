const pool = require('../config/database');

const ASSISTANT_NAME = 'Trợ lý Phenikaa Dental';

const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const timeToMinutes = (time) => {
    const [hour, minute] = String(time || '00:00').slice(0, 5).split(':').map(Number);
    return hour * 60 + minute;
};

const minutesToTime = (minutes) => {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const formatDate = (date) => {
    const value = date instanceof Date ? date : new Date(`${String(date).slice(0, 10)}T00:00:00`);
    return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
};

const formatDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

const topicCatalog = [
    {
        id: 'emergency',
        label: 'Tình huống cần ưu tiên',
        keywords: ['dau du doi', 'sung mat', 'sot', 'chay mau khong cam', 'nga dap', 'gay rang', 'chan thuong', 'ap xe', 'mu', 'kho tho', 'kho nuot'],
        serviceHints: ['kham', 'tu van', 'nho rang', 'dieu tri tuy'],
        duration: 30,
        answer: 'Triệu chứng bạn mô tả có thể cần được kiểm tra sớm. Nếu đau dữ dội, sưng mặt, sốt, chảy máu không cầm, khó nuốt hoặc khó thở, bạn nên gọi hotline ngay để được lễ tân ưu tiên lịch và hướng dẫn đến phòng khám.',
        booking: 'Khi đặt lịch, hãy chọn Khám và tư vấn nha khoa, ghi rõ triệu chứng trong phần ghi chú để lễ tân/bác sĩ nắm trước.'
    },
    {
        id: 'wisdom_tooth',
        label: 'Đau răng khôn / nhổ răng',
        keywords: ['rang khon', 'moc rang', 'nho rang', 'dau ham', 'sung loi cuoi ham'],
        serviceHints: ['nho rang', 'rang khon', 'kham', 'tu van'],
        duration: 30,
        answer: 'Với răng khôn, bạn nên đặt lịch khám/tư vấn trước để bác sĩ kiểm tra hướng mọc, tình trạng viêm và chỉ định chụp phim nếu cần.',
        booking: 'Bạn có thể chọn dịch vụ Khám và tư vấn nha khoa hoặc Nhổ răng khôn, sau đó chọn bác sĩ và khung giờ trống.'
    },
    {
        id: 'toothache',
        label: 'Đau răng / sâu răng / ê buốt',
        keywords: ['dau rang', 'nhuc rang', 'sau rang', 'e buot', 'lo sau', 'mat mieng tram', 'tram rang'],
        serviceHints: ['tram', 'sau rang', 'kham', 'tu van', 'dieu tri tuy'],
        duration: 30,
        answer: 'Đau răng, sâu răng hoặc ê buốt có thể liên quan tới sâu răng, viêm tủy, mòn cổ răng hoặc miếng trám cũ. Bác sĩ cần khám trực tiếp để xác định mức độ.',
        booking: 'Bạn nên đặt Khám và tư vấn nha khoa. Nếu đã biết răng bị sâu/mẻ, có thể chọn thêm Trám răng để hệ thống tính thời lượng phù hợp hơn.'
    },
    {
        id: 'root_canal',
        label: 'Điều trị tủy',
        keywords: ['lay tuy', 'dieu tri tuy', 'viem tuy', 'dau len tan dau', 'dau ve dem'],
        serviceHints: ['tuy', 'dieu tri tuy', 'kham'],
        duration: 60,
        answer: 'Đau nhói, đau về đêm hoặc đau lan lên đầu có thể cần kiểm tra tủy răng. Điều trị tủy thường cần bác sĩ đánh giá phim và mức độ viêm trước.',
        booking: 'Bạn nên chọn Khám và tư vấn nha khoa hoặc Điều trị tủy nếu dịch vụ đang có trong danh sách.'
    },
    {
        id: 'gum',
        label: 'Viêm lợi / chảy máu chân răng',
        keywords: ['chay mau chan rang', 'viem loi', 'sung loi', 'hoi mieng', 'cao voi', 'lay cao rang', 'nha chu'],
        serviceHints: ['cao voi', 'nha chu', 'kham', 'tu van'],
        duration: 30,
        answer: 'Chảy máu chân răng, hôi miệng hoặc sưng lợi thường liên quan tới cao răng, viêm lợi hoặc nha chu. Khám sớm giúp tránh tình trạng tụt lợi, lung lay răng.',
        booking: 'Bạn có thể chọn Cạo vôi răng hoặc Khám và tư vấn nha khoa.'
    },
    {
        id: 'braces',
        label: 'Niềng răng / chỉnh nha',
        keywords: ['nieng rang', 'chinh nha', 'rang ho', 'rang mom', 'rang lech', 'khap khenh', 'chen chuc'],
        serviceHints: ['nieng', 'chinh nha', 'kham', 'tu van'],
        duration: 45,
        answer: 'Niềng răng cần khám, chụp phim và tư vấn phác đồ trước. Bác sĩ sẽ đánh giá khớp cắn, độ lệch răng và thời gian điều trị dự kiến.',
        booking: 'Bạn nên đặt lịch tư vấn chỉnh nha, ưu tiên khung giờ bạn có thể trao đổi kỹ với bác sĩ.'
    },
    {
        id: 'implant',
        label: 'Cấy ghép Implant / mất răng',
        keywords: ['implant', 'cay ghep', 'mat rang', 'trong rang', 'mat nhieu rang'],
        serviceHints: ['implant', 'cay ghep', 'kham', 'tu van'],
        duration: 60,
        answer: 'Với trường hợp mất răng hoặc muốn cấy Implant, bác sĩ cần kiểm tra xương hàm, vị trí mất răng và tình trạng sức khỏe tổng quát trước khi tư vấn kế hoạch.',
        booking: 'Bạn nên chọn Tư vấn Implant hoặc Khám và tư vấn nha khoa. Nếu có phim/chụp cũ, hãy mang theo khi đến khám.'
    },
    {
        id: 'whitening',
        label: 'Tẩy trắng răng',
        keywords: ['tay trang', 'rang vang', 'rang xin mau', 'rang nhiem mau', 'lam trang rang'],
        serviceHints: ['tay trang', 'kham', 'tu van'],
        duration: 45,
        answer: 'Tẩy trắng phù hợp khi răng xỉn màu hoặc nhiễm màu nhẹ. Trước khi tẩy, bác sĩ thường kiểm tra sâu răng, ê buốt và cao răng để tránh khó chịu sau điều trị.',
        booking: 'Bạn có thể chọn Tẩy trắng răng. Nếu lâu chưa lấy cao răng, nên khám/tư vấn trước.'
    },
    {
        id: 'cosmetic',
        label: 'Răng sứ / Veneer / thẩm mỹ',
        keywords: ['rang su', 'boc su', 'dan su', 'veneer', 'tham my', 'cuoi ho loi', 'rang me', 'rang thua'],
        serviceHints: ['rang su', 'veneer', 'tham my', 'kham', 'tu van'],
        duration: 60,
        answer: 'Răng sứ, veneer hoặc điều trị thẩm mỹ cần bác sĩ kiểm tra men răng, khớp cắn, màu răng và mong muốn thẩm mỹ trước khi báo kế hoạch.',
        booking: 'Bạn nên chọn dịch vụ Răng sứ thẩm mỹ hoặc Khám và tư vấn nha khoa.'
    },
    {
        id: 'children',
        label: 'Nha khoa trẻ em',
        keywords: ['tre em', 'rang sua', 'be dau rang', 'be sau rang', 'nha khoa tre em', 'rang be'],
        serviceHints: ['tre em', 'kham', 'tram', 'tu van'],
        duration: 30,
        answer: 'Với trẻ em, nên đặt lịch ở khung giờ bé tỉnh táo, ít mệt. Bác sĩ sẽ kiểm tra răng sữa, sâu răng, mọc răng và hướng dẫn chăm sóc tại nhà.',
        booking: 'Bạn có thể chọn Khám và tư vấn nha khoa, ghi chú tuổi của bé và triệu chứng hiện tại.'
    }
];

const operationTopics = {
    payment: ['thanh toan', 'vnpay', 'qr', 'hoa don', 'chuyen khoan', 'tien mat', 'the', 'da thanh toan'],
    reschedule: ['doi lich', 'huy lich', 'doi gio', 'doi ngay', 'doi bac si', 'tre lich', 'khong den duoc'],
    profile: ['ho so', 'lich su kham', 'don thuoc', 'ket qua kham', 'phac do', 'tai kham'],
    location: ['dia chi', 'map', 'duong di', 'den dau', 'phong nao', 'gap ai', 'check in'],
    doctor: ['bac si nao', 'nen chon bac si', 'ai kham', 'bac si gioi', 'bac si trong'],
    opening: ['gio lam viec', 'mo cua', 'dong cua', 'hotline', 'so dien thoai']
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasKeyword = (text, keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) return false;
    return new RegExp(`(^|\\s)${escapeRegExp(normalizedKeyword)}(\\s|$)`).test(text);
};

const hasAny = (text, keywords) => keywords.some((keyword) => hasKeyword(text, keyword));

const getSettings = async () => {
    const defaults = {
        clinicName: 'Phenikaa Dental',
        phone: '0869 800 318',
        address: 'Tòa nhà Phenikaa Tower, Hà Đông, Hà Nội',
        openingHours: '08:00 - 20:00',
        mapUrl: '',
        bookingLeadHours: '24'
    };

    const [rows] = await pool.query(
        'SELECT settingKey, settingValue FROM Settings WHERE settingKey IN (?)',
        [Object.keys(defaults)]
    );

    return rows.reduce((settings, row) => ({
        ...settings,
        [row.settingKey]: row.settingValue
    }), defaults);
};

const getEarliestBookableDateTime = (leadHours = 24) => {
    const safeLeadHours = Number.isFinite(Number(leadHours)) && Number(leadHours) >= 0 ? Number(leadHours) : 24;

    if (safeLeadHours >= 24) {
        const earliest = new Date();
        earliest.setHours(0, 0, 0, 0);
        earliest.setDate(earliest.getDate() + Math.ceil(safeLeadHours / 24));
        return earliest;
    }

    return new Date(Date.now() + safeLeadHours * 60 * 60 * 1000);
};

const getBusyRanges = async (dentistId, date) => {
    const [rows] = await pool.query(
        `SELECT
            a.id,
            a.appointmentTime,
            COALESCE(SUM(COALESCE(s.duration, 30)), 30) as duration
         FROM Appointments a
         LEFT JOIN Appointment_Services aps ON aps.appointmentId = a.id
         LEFT JOIN Services s ON s.id = aps.serviceId
         WHERE a.dentistId = ?
           AND a.appointmentDate = ?
           AND a.status NOT IN ("cancelled", "no_show")
         GROUP BY a.id, a.appointmentTime`,
        [dentistId, date]
    );

    return rows.map((row) => {
        const start = timeToMinutes(row.appointmentTime);
        return {
            start,
            end: start + Math.max(Number(row.duration || 30), 30)
        };
    });
};

const findAvailableSlots = async ({ days = 10, limit = 5, duration = 30 } = {}) => {
    const settings = await getSettings();
    const earliestBookable = getEarliestBookableDateTime(settings.bookingLeadHours);
    const [dentists] = await pool.query(
        `SELECT id, fullName
         FROM Users
         WHERE role = "dentist" AND status = "active"
         ORDER BY fullName ASC`
    );

    if (dentists.length === 0) return [];

    const results = [];
    const candidateLimit = Math.max(limit * 8, limit);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let dayOffset = 0; dayOffset < days && results.length < candidateLimit; dayOffset += 1) {
        const date = new Date(today);
        date.setDate(today.getDate() + dayOffset);
        const dateKey = formatDateKey(date);
        const dayOfWeek = date.getDay();

        for (const dentist of dentists) {
            const [[schedule]] = await pool.query(
                `SELECT startTime, endTime, breakStart, breakEnd, slotIntervalMinutes, isActive
                 FROM DoctorSchedules
                 WHERE dentistId = ? AND dayOfWeek = ?
                 LIMIT 1`,
                [dentist.id, dayOfWeek]
            );

            if (!schedule || Number(schedule.isActive) !== 1) continue;

            const [daysOff] = await pool.query(
                'SELECT id FROM DoctorDaysOff WHERE dentistId = ? AND offDate = ? LIMIT 1',
                [dentist.id, dateKey]
            );
            if (daysOff.length > 0) continue;

            const busyRanges = await getBusyRanges(dentist.id, dateKey);
            const workStart = timeToMinutes(schedule.startTime);
            const workEnd = timeToMinutes(schedule.endTime);
            const breakStart = schedule.breakStart ? timeToMinutes(schedule.breakStart) : null;
            const breakEnd = schedule.breakEnd ? timeToMinutes(schedule.breakEnd) : null;
            const interval = Number(schedule.slotIntervalMinutes || 30);

            for (let minutes = workStart; minutes + duration <= workEnd && results.length < candidateLimit; minutes += interval) {
                const slotEnd = minutes + duration;
                const time = minutesToTime(minutes);
                const dateTime = new Date(`${dateKey}T${time}:00`);
                const inBreak = breakStart !== null && breakEnd !== null && rangesOverlap(minutes, slotEnd, breakStart, breakEnd);
                const isBooked = busyRanges.some((range) => rangesOverlap(minutes, slotEnd, range.start, range.end));

                if (dateTime >= earliestBookable && !inBreak && !isBooked) {
                    results.push({
                        dentistId: dentist.id,
                        dentistName: dentist.fullName,
                        date: dateKey,
                        time
                    });
                }
            }
        }
    }

    return results.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)).slice(0, limit);
};

const findTopic = (text) => topicCatalog.find((topic) => hasAny(text, topic.keywords)) || null;

const getRelevantServices = async (topic, text) => {
    const [services] = await pool.query(
        `SELECT id, name, price, duration, description
         FROM Services
         WHERE status = "active"
         ORDER BY name ASC
         LIMIT 80`
    );

    const hints = topic?.serviceHints || [];
    const normalizedText = normalizeText(text);

    const matched = services.filter((service) => {
        const serviceText = normalizeText(`${service.name} ${service.description || ''}`);
        if (hints.length > 0 && hints.some((hint) => serviceText.includes(hint))) return true;
        return normalizedText.split(' ').some((word) => word.length >= 4 && serviceText.includes(word));
    });

    return (matched.length ? matched : services).slice(0, 4);
};

const buildSlotText = (slots) => {
    if (!slots.length) {
        return 'Hiện chưa tìm thấy slot trống gần nhất trong vài ngày tới. Bạn có thể để lại triệu chứng, lễ tân sẽ kiểm tra và phản hồi thêm.';
    }

    return slots.map((slot, index) => (
        `${index + 1}. ${slot.time} ngày ${formatDate(slot.date)} với ${slot.dentistName}`
    )).join('\n');
};

const buildServiceText = (services) => {
    if (!services.length) return '';
    return services.map((service) => {
        const price = Number(service.price || 0).toLocaleString('vi-VN');
        const duration = service.duration ? `, khoảng ${service.duration} phút` : '';
        return `- ${service.name}: ${price} đ${duration}`;
    }).join('\n');
};

const buildLocationText = (settings) => {
    const lines = [
        `Địa chỉ: ${settings.address}.`,
        'Khi đến, bạn gặp quầy lễ tân để check-in. Lễ tân sẽ xác nhận lịch, điều phối phòng khám và bác sĩ phụ trách.'
    ];

    if (settings.mapUrl) lines.push(`Bản đồ: ${settings.mapUrl}`);
    lines.push(`Hotline hỗ trợ: ${settings.phone}.`);
    return lines.join('\n');
};

const detectIntent = (message) => {
    const text = normalizeText(message);
    const topic = findTopic(text);

    return {
        text,
        topic,
        isClinical: Boolean(topic),
        isBooking: hasAny(text, ['dat lich', 'dang ky', 'lich kham', 'hen kham', 'booking']),
        isSlot: hasAny(text, ['trong', 'gan nhat', 'it nguoi', 'luc nao', 'thoi diem', 'gio nao', 'bac si nao', 'slot']),
        isProcedure: hasAny(text, ['quy trinh', 'den dau', 'phong nao', 'gap ai', 'map', 'duong di', 'dia chi', 'check in']),
        isService: hasAny(text, ['dich vu', 'gia', 'chi phi', 'bao nhieu', 'tu van gia']),
        isPayment: hasAny(text, operationTopics.payment),
        isReschedule: hasAny(text, operationTopics.reschedule),
        isProfile: hasAny(text, operationTopics.profile),
        isOpening: hasAny(text, operationTopics.opening),
        isDoctor: hasAny(text, operationTopics.doctor),
        isGreeting: /^(xin chao|chao|alo|hello|hi|tu van|can tu van)/.test(text)
    };
};

const appendSuggestedSlots = async (lines, topic, limit = 3) => {
    const slots = await findAvailableSlots({
        days: 14,
        limit,
        duration: topic?.duration || 30
    });

    lines.push(`Gợi ý lịch gần nhất:\n${buildSlotText(slots)}`);
};

const appendRelatedServices = async (lines, topic, text) => {
    const services = await getRelevantServices(topic, text);
    const serviceText = buildServiceText(services);
    if (serviceText) {
        lines.push(`Dịch vụ liên quan:\n${serviceText}`);
    }
};

const buildClinicalReply = async (intent) => {
    const lines = [
        intent.topic.answer,
        intent.topic.booking
    ];
    const asksAvailability = /(^|\s)(trong|gan nhat|it nguoi|luc nao|thoi diem|gio nao|bac si nao|slot)(\s|$)/.test(intent.text);

    if (intent.isBooking && !asksAvailability) {
        lines.push('Bấm Đặt lịch ngay, chọn dịch vụ, bác sĩ, ngày giờ rồi gửi yêu cầu. Lễ tân sẽ xác nhận sau khi bạn đặt.');
    } else if (asksAvailability) {
        lines.push('');
        await appendSuggestedSlots(lines, intent.topic, 3);
    } else if (intent.isBooking) {
        lines.push('Bấm Đặt lịch ngay, chọn dịch vụ, bác sĩ, ngày giờ rồi gửi yêu cầu. Lễ tân sẽ xác nhận sau khi bạn đặt.');
    } else {
        const services = await getRelevantServices(intent.topic, intent.text);
        if (services.length > 0) {
            lines.push('');
            lines.push(`Dịch vụ phù hợp: ${services.slice(0, 2).map((service) => service.name).join(', ')}.`);
        }
    }

    return lines;
};

const action = (label, type, value) => ({ label, type, value });

const commonActions = (settings = {}) => [
    action('Đặt lịch ngay', 'route', '/book-appointment'),
    action('Xem lịch hẹn', 'route', '/profile?tab=appointments'),
    action('Gặp nhân viên', 'message', 'Tôi muốn gặp nhân viên hỗ trợ'),
    ...(settings.mapUrl ? [action('Mở bản đồ', 'url', settings.mapUrl)] : [])
];

const getPatientAppointments = async (patientId) => {
    if (!Number.isInteger(Number(patientId)) || Number(patientId) <= 0) return [];

    const [rows] = await pool.query(
        `SELECT
            a.id,
            a.appointmentDate,
            a.appointmentTime,
            a.status,
            dentist.fullName as dentistName,
            GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') as serviceNames
         FROM Appointments a
         LEFT JOIN Users dentist ON dentist.id = a.dentistId
         LEFT JOIN Appointment_Services aps ON aps.appointmentId = a.id
         LEFT JOIN Services s ON s.id = aps.serviceId
         WHERE a.patientId = ?
           AND a.status IN ("pending", "confirmed", "arrived", "in_progress")
           AND TIMESTAMP(a.appointmentDate, a.appointmentTime) >= NOW()
         GROUP BY a.id, a.appointmentDate, a.appointmentTime, a.status, dentist.fullName
         ORDER BY a.appointmentDate ASC, a.appointmentTime ASC
         LIMIT 5`,
        [patientId]
    );

    return rows;
};

const getPatientInvoices = async (patientId) => {
    if (!Number.isInteger(Number(patientId)) || Number(patientId) <= 0) return [];

    const [rows] = await pool.query(
        `SELECT
            i.id,
            i.totalAmount,
            i.paidAmount,
            i.status,
            i.paymentMethod,
            (i.totalAmount - i.paidAmount) as outstandingAmount,
            a.appointmentDate,
            GROUP_CONCAT(ii.description ORDER BY ii.id SEPARATOR ', ') as itemNames
         FROM Invoices i
         JOIN Appointments a ON a.id = i.appointmentId
         LEFT JOIN InvoiceItems ii ON ii.invoiceId = i.id
         WHERE i.patientId = ?
           AND i.status IN ("unpaid", "partial")
         GROUP BY i.id, i.totalAmount, i.paidAmount, i.status, i.paymentMethod, a.appointmentDate
         ORDER BY i.createdAt DESC
         LIMIT 5`,
        [patientId]
    );

    return rows;
};

const buildPatientAppointmentText = (appointments) => {
    if (!appointments.length) {
        return 'Hiện mình chưa thấy lịch hẹn sắp tới nào trong tài khoản của bạn. Bạn có thể đặt lịch mới hoặc nhắn lễ tân kiểm tra thêm nếu đã đặt qua kênh khác.';
    }

    const statusLabels = {
        pending: 'chờ xác nhận',
        confirmed: 'đã xác nhận',
        arrived: 'đã đến',
        in_progress: 'đang khám'
    };

    return [
        'Lịch hẹn sắp tới của bạn:',
        ...appointments.map((appointment, index) => (
            `${index + 1}. #${appointment.id} - ${String(appointment.appointmentTime).slice(0, 5)} ngày ${formatDate(appointment.appointmentDate)}`
            + `${appointment.dentistName ? ` với ${appointment.dentistName}` : ''}`
            + `${appointment.serviceNames ? `, dịch vụ: ${appointment.serviceNames}` : ''}`
            + ` (${statusLabels[appointment.status] || appointment.status}).`
        ))
    ].join('\n');
};

const buildPatientInvoiceText = (invoices) => {
    if (!invoices.length) {
        return 'Hiện mình chưa thấy hóa đơn chưa thanh toán trong tài khoản của bạn.';
    }

    return [
        'Các hóa đơn còn cần thanh toán:',
        ...invoices.map((invoice, index) => {
            const outstanding = Number(invoice.outstandingAmount || 0).toLocaleString('vi-VN');
            const total = Number(invoice.totalAmount || 0).toLocaleString('vi-VN');
            return `${index + 1}. INV-${invoice.id}: còn ${outstanding} đ / tổng ${total} đ`
                + `${invoice.itemNames ? `, nội dung: ${invoice.itemNames}` : ''}.`;
        }),
        'Bạn có thể mở tab Hóa đơn để thanh toán VNPay QR hoặc kiểm tra trạng thái thanh toán.'
    ].join('\n');
};

const detectPersonalIntent = (text) => ({
    appointment: hasAny(text, ['lich cua toi', 'lich cua minh', 'lich hen cua toi', 'lich hen cua minh', 'lich sap toi', 'toi co lich', 'xem lich hen', 'lich hom nay']),
    invoice: hasAny(text, ['hoa don cua toi', 'hoa don cua minh', 'hoa don chua thanh toan', 'xem hoa don', 'toi con no', 'can thanh toan', 'chua thanh toan']),
    human: hasAny(text, ['gap nhan vien', 'gap le tan', 'can nguoi tu van', 'nhan vien ho tro', 'tu van vien', 'goi lai'])
});

const buildReply = async (message) => {
    const intent = detectIntent(message);
    const settings = await getSettings();
    const lines = [];

    if (intent.isClinical) {
        lines.push(...await buildClinicalReply(intent, settings));
    } else if (intent.isPayment) {
        lines.push('Về thanh toán, phòng khám có thể ghi nhận tiền mặt, thẻ/chuyển khoản và VNPay QR nếu hóa đơn hỗ trợ.');
        lines.push('Nếu bạn thanh toán bằng VNPay QR, hệ thống sẽ cập nhật trạng thái khi VNPay trả kết quả thành công. Nếu trạng thái chưa đổi ngay, lễ tân có thể bấm kiểm tra lại hoặc xác nhận theo giao dịch.');
        lines.push('Sau khi hóa đơn đã ghi nhận đủ tiền, lễ tân/admin có thể xuất hoặc in hóa đơn.');
    } else if (intent.isReschedule) {
        lines.push('Bạn có thể đổi/hủy lịch nếu còn trong thời gian cho phép của phòng khám.');
        lines.push('Cách làm: vào hồ sơ/lịch hẹn của bạn, chọn lịch cần đổi hoặc hủy, sau đó chọn ngày giờ mới. Nếu lịch đã được xác nhận hoặc cần đổi bác sĩ, lễ tân/admin sẽ kiểm tra và duyệt theo quy trình.');
        await appendSuggestedSlots(lines, null, 4);
    } else if (intent.isProfile) {
        lines.push('Hồ sơ khám dùng để xem lịch sử lịch hẹn, chẩn đoán, kế hoạch điều trị, ngày tái khám và hóa đơn liên quan.');
        lines.push('Nếu bạn vừa khám xong mà chưa thấy hồ sơ, bác sĩ có thể chưa hoàn tất ghi hồ sơ hoặc lễ tân chưa cập nhật trạng thái hoàn thành.');
    } else if (intent.isProcedure) {
        lines.push(`Quy trình khi đến ${settings.clinicName}:`);
        lines.push('1. Đến phòng khám đúng giờ hẹn.');
        lines.push('2. Gặp lễ tân để check-in và xác nhận thông tin.');
        lines.push('3. Chờ điều phối vào phòng khám theo bác sĩ phụ trách.');
        lines.push('4. Bác sĩ khám, tư vấn dịch vụ/kế hoạch điều trị và chi phí.');
        lines.push('5. Sau điều trị, lễ tân hỗ trợ hóa đơn, thanh toán và lịch tái khám nếu có.');
        lines.push('');
        lines.push(buildLocationText(settings));
    } else if (intent.isBooking || intent.isSlot || intent.isDoctor) {
        lines.push('Mình có thể gợi ý lịch dựa trên lịch làm việc của bác sĩ, ngày nghỉ riêng và các lịch đã được đặt.');
        await appendSuggestedSlots(lines, null, 5);
        lines.push('');
        lines.push('Thời điểm thường dễ chọn hơn là đầu buổi sáng hoặc đầu buổi chiều. Sau khi đặt online, lễ tân sẽ xác nhận lịch trước khi bạn đến.');
    } else if (intent.isService) {
        lines.push('Một số dịch vụ đang hoạt động:');
        lines.push(buildServiceText(await getRelevantServices(null, intent.text)) || 'Chưa có dịch vụ phù hợp đang hiển thị.');
        lines.push('');
        lines.push('Giá có thể thay đổi theo tình trạng răng thực tế, bác sĩ sẽ tư vấn lại sau khi khám.');
    } else if (intent.isOpening) {
        lines.push(`${settings.clinicName} làm việc: ${settings.openingHours}.`);
        lines.push(`Hotline: ${settings.phone}.`);
        lines.push(buildLocationText(settings));
    } else if (intent.isGreeting) {
        lines.push(`Chào bạn, mình là ${ASSISTANT_NAME}.`);
        lines.push('Bạn có thể hỏi về đau răng, sâu răng, răng khôn, niềng răng, Implant, tẩy trắng, răng sứ, trẻ em, đặt lịch, đổi lịch, thanh toán hoặc quy trình khi đến khám.');
        lines.push(`${settings.clinicName} làm việc: ${settings.openingHours}. Hotline: ${settings.phone}.`);
    } else {
        lines.push('Mình đã nhận câu hỏi của bạn. Bạn có thể mô tả rõ hơn triệu chứng, dịch vụ muốn làm hoặc nhu cầu đặt lịch để mình gợi ý chính xác hơn.');
        lines.push('');
        await appendSuggestedSlots(lines, null, 3);
    }

    lines.push('');
    lines.push('Lưu ý: phần trả lời này chỉ hỗ trợ định hướng ban đầu, chẩn đoán chính thức cần bác sĩ thăm khám trực tiếp.');

    return lines.join('\n').trim();
};

const buildFocusedReply = async (message) => {
    const intent = detectIntent(message);
    const settings = await getSettings();
    const lines = [];

    if (intent.isClinical) {
        lines.push(intent.topic.answer);
        lines.push(intent.topic.booking);
        const asksAvailability = /(^|\s)(trong|gan nhat|it nguoi|luc nao|thoi diem|gio nao|bac si nao|slot)(\s|$)/.test(intent.text);

        if (intent.topic.id === 'emergency') {
            lines.push(`Trường hợp này nên gọi hotline ${settings.phone} để được ưu tiên hỗ trợ.`);
        } else if (intent.isBooking && !asksAvailability) {
            lines.push('Bấm Đặt lịch ngay, chọn dịch vụ, bác sĩ, ngày giờ rồi gửi yêu cầu. Lễ tân sẽ xác nhận sau khi bạn đặt.');
        } else if (asksAvailability) {
            lines.push('');
            await appendSuggestedSlots(lines, intent.topic, 3);
        } else {
            const services = await getRelevantServices(intent.topic, intent.text);
            if (services.length > 0) {
                lines.push(`Dịch vụ phù hợp: ${services.slice(0, 2).map((service) => service.name).join(', ')}.`);
            }
        }
    } else if (intent.isPayment) {
        lines.push('Bạn có thể thanh toán bằng tiền mặt, thẻ/chuyển khoản hoặc VNPay QR nếu hóa đơn hỗ trợ.');
        lines.push('Với VNPay QR, trạng thái hóa đơn sẽ đổi khi hệ thống nhận kết quả thanh toán thành công.');
    } else if (intent.isReschedule) {
        lines.push('Bạn có thể đổi/hủy lịch trong phần Hồ sơ > Lịch hẹn nếu còn trong thời gian cho phép.');
        lines.push('Nếu cần đổi bác sĩ hoặc lịch đã xác nhận, lễ tân/admin sẽ kiểm tra và duyệt.');
    } else if (intent.isProfile) {
        lines.push('Hồ sơ khám dùng để xem lịch sử khám, chẩn đoán, kế hoạch điều trị, tái khám và hóa đơn liên quan.');
        lines.push('Nếu vừa khám xong mà chưa thấy hồ sơ, bác sĩ có thể chưa hoàn tất ghi hồ sơ.');
    } else if (intent.isProcedure) {
        lines.push(`Quy trình khi đến ${settings.clinicName}:`);
        lines.push('1. Gặp lễ tân để check-in và xác nhận lịch.');
        lines.push('2. Chờ điều phối vào phòng khám theo bác sĩ phụ trách.');
        lines.push('3. Bác sĩ khám/tư vấn, sau đó lễ tân hỗ trợ thanh toán và tái khám nếu có.');
        lines.push('');
        lines.push(`Địa chỉ: ${settings.address}.`);
        if (settings.mapUrl) lines.push(`Bản đồ: ${settings.mapUrl}`);
        lines.push(`Hotline hỗ trợ: ${settings.phone}.`);
    } else if (intent.isBooking || intent.isSlot || intent.isDoctor) {
        if (intent.isSlot || intent.isDoctor) {
            await appendSuggestedSlots(lines, null, 5);
            lines.push('Sau khi đặt online, lễ tân sẽ xác nhận lịch.');
        } else {
            lines.push('Bấm Đặt lịch ngay, chọn dịch vụ, bác sĩ, ngày giờ rồi gửi yêu cầu.');
            lines.push('Sau khi lịch được xác nhận, hệ thống/lễ tân sẽ hướng dẫn thông tin đến khám.');
        }
    } else if (intent.isService) {
        lines.push('Dịch vụ đang hoạt động:');
        lines.push(buildServiceText(await getRelevantServices(null, intent.text)) || 'Chưa có dịch vụ phù hợp đang hiển thị.');
        lines.push('Giá có thể thay đổi theo tình trạng thực tế sau khi bác sĩ khám.');
    } else if (intent.isOpening) {
        lines.push(`${settings.clinicName} làm việc: ${settings.openingHours}.`);
        lines.push(`Hotline: ${settings.phone}.`);
    } else if (intent.isGreeting) {
        lines.push(`Chào bạn, mình là ${ASSISTANT_NAME}.`);
        lines.push('Bạn cần tư vấn dịch vụ, xem lịch trống hay kiểm tra lịch/hóa đơn của mình?');
    } else {
        lines.push('Bạn mô tả rõ hơn triệu chứng hoặc dịch vụ muốn làm nhé. Mình sẽ gợi ý đúng hơn.');
    }

    if (intent.isClinical) {
        lines.push('');
        lines.push('Thông tin này chỉ mang tính định hướng; chẩn đoán chính thức cần bác sĩ thăm khám.');
    }

    return lines.join('\n').trim();
};

const buildAssistantResponse = async (message, context = {}) => {
    const text = normalizeText(message);
    const intent = detectIntent(message);
    const personalIntent = detectPersonalIntent(text);
    const settings = await getSettings();
    const patientId = Number(context.patientId || context.user?.id || 0);
    const quickActions = commonActions(settings);
    let responseText = '';
    let needsStaff = false;
    let priorityReason = '';

    if (personalIntent.appointment && patientId > 0) {
        const appointments = await getPatientAppointments(patientId);
        responseText = buildPatientAppointmentText(appointments);
        quickActions.unshift(action('Mở lịch hẹn', 'route', '/profile?tab=appointments'));
    } else if (personalIntent.invoice && patientId > 0) {
        const invoices = await getPatientInvoices(patientId);
        responseText = buildPatientInvoiceText(invoices);
        quickActions.unshift(action('Mở hóa đơn', 'route', '/profile?tab=invoices'));
    } else {
        responseText = await buildFocusedReply(message);
    }

    if (personalIntent.human) {
        needsStaff = true;
        priorityReason = 'Khách yêu cầu nhân viên hỗ trợ.';
        responseText = [
            'Mình đã ghi nhận yêu cầu gặp nhân viên. Lễ tân sẽ thấy hội thoại này ở nhóm cần xử lý và phản hồi cho bạn.',
            '',
            responseText
        ].join('\n').trim();
    }

    if (intent.topic?.id === 'emergency') {
        needsStaff = true;
        priorityReason = 'Triệu chứng cần ưu tiên kiểm tra.';
    }

    const metadata = {
        intent: intent.topic?.id || (personalIntent.appointment ? 'patient_appointments' : personalIntent.invoice ? 'patient_invoices' : personalIntent.human ? 'human_support' : 'general'),
        needsStaff,
        priorityReason,
        quickActions: quickActions.slice(0, 4)
    };

    return {
        message: responseText,
        metadata,
        needsStaff,
        priorityReason
    };
};

const getAssistantSenderId = async () => {
    const [[user]] = await pool.query(
        `SELECT id
         FROM Users
         WHERE role IN ("staff", "admin") AND status = "active"
         ORDER BY FIELD(role, "staff", "admin"), id ASC
         LIMIT 1`
    );

    return user?.id || null;
};

module.exports = {
    ASSISTANT_NAME,
    buildReply,
    buildAssistantResponse,
    getAssistantSenderId
};
