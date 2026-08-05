const pool = require('../config/database');
const { generateAiReply, getAiConfig } = require('./aiChat.service');
const { publicBookingError } = require('../utils/chatPolicy');
const {
    detectAppointmentScope,
    detectBookingEditIntent,
    detectIntentMessage,
    detectInvoiceScope,
    detectPersonalIntent,
    findBestByKeywords,
    getChoiceNumber,
    hasAny,
    isBookingConfirmIntent,
    isBookingStartIntent,
    isCancelBookingDraft,
    isGenericConsultIntent,
    isHumanSupportIntent,
    isNewConsultationIntent,
    normalizeText,
    parseRequestedDate,
    parseRequestedTime,
    parseRequestedTimeWindow,
    pickNumberedChoice,
    scoreKeywords,
    shouldClarifyIntent
} = require('./chatIntent.service');
const {
    applyBookingEdit,
    clearConversationAssistantState,
    createBookingDraft,
    createIntentClarificationState,
    getConversationAssistantState,
    resolveIntentClarification,
    saveConversationAssistantState
} = require('./chatDialogue.service');
const { createAppointmentFromChat } = require('./chatAppointmentTool.service');
const { createKnowledgeRetriever, toSourceMetadata } = require('./chatKnowledge.service');
const { attachQualityTelemetry } = require('./aiQuality.service');

const ASSISTANT_NAME = 'Trợ lý AI Phenikaa Dental';

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
    },
    {
        id: 'broken_tooth',
        label: 'Mẻ/vỡ răng',
        keywords: ['me rang', 'vo rang', 'nut rang', 'gay men', 'sap rang', 'rang bi vo', 'rang bi me', 'can bi dau'],
        serviceHints: ['tram', 'rang su', 'kham', 'tu van'],
        duration: 45,
        answer: 'Răng mẻ/vỡ cần bác sĩ kiểm tra độ sâu tổn thương, có lộ tủy hay nứt chân răng không. Không nên tự mài hoặc cắn đồ cứng ở vùng răng đó.',
        booking: 'Bạn nên đặt Khám và tư vấn nha khoa. Nếu mẻ nhỏ có thể trám, nếu vỡ lớn bác sĩ sẽ tư vấn phục hình phù hợp.'
    },
    {
        id: 'lost_filling',
        label: 'Rơi miếng trám / bong phục hình',
        keywords: ['roi tram', 'bung tram', 'mat mieng tram', 'roi mieng tram', 'bung rang su', 'long rang su', 'roi rang su', 'roi veneer'],
        serviceHints: ['tram', 'rang su', 'kham', 'tu van'],
        duration: 45,
        answer: 'Miếng trám hoặc phục hình bị bong làm răng dễ ê buốt, kẹt thức ăn và sâu lại. Bạn nên khám sớm để bác sĩ kiểm tra và xử lý lại bề mặt răng.',
        booking: 'Bạn có thể chọn Khám và tư vấn nha khoa hoặc Trám răng nếu dịch vụ có trong danh sách.'
    },
    {
        id: 'bad_breath',
        label: 'Hôi miệng',
        keywords: ['hoi mieng', 'mui hoi', 'hoi tho co mui', 'mieng hoi', 'cao rang nhieu'],
        serviceHints: ['cao voi', 'nha chu', 'kham', 'tu van'],
        duration: 30,
        answer: 'Hôi miệng thường liên quan tới cao răng, viêm lợi, sâu răng, kẹt thức ăn hoặc vệ sinh lưỡi chưa tốt. Bác sĩ cần kiểm tra khoang miệng để tìm nguyên nhân.',
        booking: 'Bạn nên chọn Cạo vôi răng hoặc Khám và tư vấn nha khoa.'
    },
    {
        id: 'after_extraction',
        label: 'Sau nhổ răng',
        keywords: ['sau nho rang', 'nho rang xong', 'chay mau sau nho', 'dau sau nho', 'o rang kho', 'hoi sau nho'],
        serviceHints: ['kham', 'tu van', 'nho rang'],
        duration: 30,
        answer: 'Sau nhổ răng, đau nhẹ và rỉ máu ít có thể gặp trong thời gian đầu. Nếu chảy máu nhiều, đau tăng, sốt, hôi miệng nặng hoặc sưng lan, bạn cần được kiểm tra sớm.',
        booking: 'Bạn nên đặt Khám và tư vấn nha khoa để bác sĩ kiểm tra vùng nhổ. Nếu chảy máu không cầm, hãy gọi hotline ngay.'
    },
    {
        id: 'orthodontic_issue',
        label: 'Sự cố niềng răng',
        keywords: ['bung mac cai', 'dut day cung', 'day cung dam', 'khay nieng', 'mat khay', 'nieng bi dau', 'mac cai dau'],
        serviceHints: ['nieng', 'chinh nha', 'kham', 'tu van'],
        duration: 30,
        answer: 'Khi bung mắc cài, dây cung đâm má hoặc mất khay niềng, bạn nên báo phòng khám để bác sĩ kiểm tra và điều chỉnh. Không nên tự cắt dây sâu trong miệng nếu không chắc chắn.',
        booking: 'Bạn nên đặt lịch tư vấn/chỉnh nha hoặc nhắn gặp nhân viên để được xếp lịch xử lý nhanh.'
    },
    {
        id: 'pregnancy',
        label: 'Khám răng khi mang thai',
        keywords: ['mang thai', 'ba bau', 'co bau', 'thai ky', 'bap benh khi mang thai', 'dau rang khi bau'],
        serviceHints: ['kham', 'tu van', 'cao voi'],
        duration: 30,
        answer: 'Khi mang thai vẫn có thể khám răng, nhưng cần báo rõ tuần thai và tình trạng sức khỏe. Bác sĩ sẽ cân nhắc phương án an toàn, hạn chế can thiệp không cần thiết.',
        booking: 'Bạn nên chọn Khám và tư vấn nha khoa, ghi chú đang mang thai và số tuần thai.'
    },
    {
        id: 'mouth_ulcer',
        label: 'Nhiệt miệng / loét miệng',
        keywords: ['nhiet mieng', 'loet mieng', 'loet loi', 'dau niem mac', 'vet loet', 'mun trong mieng'],
        serviceHints: ['kham', 'tu van'],
        duration: 30,
        answer: 'Vết loét miệng thường tự giảm, nhưng nếu kéo dài, đau nhiều, tái phát liên tục hoặc kèm sốt/sưng hạch thì nên khám để loại trừ nguyên nhân khác.',
        booking: 'Bạn có thể chọn Khám và tư vấn nha khoa để bác sĩ kiểm tra niêm mạc miệng.'
    }
];

const knowledgeBase = [
    {
        id: 'booking_flow',
        title: 'Đặt lịch qua AI',
        keywords: ['muon dat lich', 'dat lich giup', 'dang ky kham', 'hen lich', 'dat ho toi', 'toi muon kham'],
        answer: 'Mình có thể đặt lịch hộ bạn ngay trong chat. Mình sẽ cần biết dịch vụ hoặc triệu chứng, ngày muốn khám, bác sĩ mong muốn và khung giờ phù hợp.'
    },
    {
        id: 'first_visit',
        title: 'Khám lần đầu',
        keywords: ['lan dau di kham', 'can mang gi', 'di kham lan dau', 'chuan bi gi', 'toi moi kham lan dau'],
        answer: 'Nếu khám lần đầu, bạn nên mang giấy tờ tùy thân, phim/chẩn đoán cũ nếu có, danh sách thuốc đang dùng và đến sớm vài phút để lễ tân check-in.'
    },
    {
        id: 'late_arrival',
        title: 'Đến muộn',
        keywords: ['den muon', 'tre gio', 'toi bi tre', 'muon hon lich', 'qua gio hen'],
        answer: 'Nếu có thể đến muộn, bạn nên báo lễ tân qua hotline. Phòng khám sẽ kiểm tra khả năng giữ lịch hoặc hỗ trợ đổi sang khung giờ phù hợp.'
    },
    {
        id: 'price_policy',
        title: 'Chi phí điều trị',
        keywords: ['gia bao nhieu', 'chi phi', 'bao gia', 'co dat khong', 'tinh tien the nao'],
        answer: 'Chi phí phụ thuộc tình trạng răng thực tế, dịch vụ cần làm và kế hoạch điều trị. Hệ thống có thể gợi ý giá dịch vụ, nhưng bác sĩ sẽ xác nhận sau khi thăm khám.'
    },
    {
        id: 'doctor_choice',
        title: 'Chọn bác sĩ',
        keywords: ['chon bac si nao', 'bac si nao tot', 'ai kham tot', 'bac si nao phu hop', 'bac si nao ranh'],
        answer: 'Bạn có thể chọn bác sĩ theo lịch trống. Nếu không chắc nên chọn ai, mình có thể gợi ý các slot gần nhất hoặc để lễ tân phân công bác sĩ phù hợp.'
    },
    {
        id: 'payment_help',
        title: 'Thanh toán',
        keywords: ['thanh toan', 'vnpay', 'qr', 'hoa don', 'chuyen khoan', 'tien mat', 'the ngan hang'],
        answer: 'Phòng khám hỗ trợ tiền mặt, thẻ/chuyển khoản và VNPay QR nếu hóa đơn có bật thanh toán. Sau khi thanh toán thành công, trạng thái hóa đơn sẽ được cập nhật trong hệ thống.'
    },
    {
        id: 'human_support',
        title: 'Gặp nhân viên',
        keywords: ['gap nhan vien', 'gap le tan', 'can nguoi tu van', 'noi chuyen voi nguoi that', 'nhan vien ho tro'],
        answer: 'Mình sẽ chuyển hội thoại sang nhóm cần nhân viên hỗ trợ để lễ tân/admin nhìn thấy và phản hồi cho bạn.'
    }
];

const knowledgeRetriever = createKnowledgeRetriever({
    database: pool,
    builtinItems: knowledgeBase,
    threshold: Number(process.env.AI_KNOWLEDGE_MIN_SCORE || 0.48)
});

const operationTopics = {
    payment: ['thanh toan', 'vnpay', 'qr', 'hoa don', 'chuyen khoan', 'tien mat', 'the', 'da thanh toan'],
    reschedule: ['doi lich', 'huy lich', 'doi gio', 'doi ngay', 'doi bac si', 'tre lich', 'khong den duoc'],
    profile: ['ho so', 'lich su kham', 'don thuoc', 'ket qua kham', 'phac do', 'tai kham'],
    location: ['dia chi', 'map', 'duong di', 'den dau', 'phong nao', 'gap ai', 'check in'],
    doctor: ['bac si nao', 'nen chon bac si', 'ai kham', 'bac si gioi', 'bac si trong'],
    opening: ['gio lam viec', 'mo cua', 'dong cua', 'hotline', 'so dien thoai']
};

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

const findTopic = (text) => (
    topicCatalog.find((topic) => hasAny(text, topic.keywords))
    || findBestByKeywords(topicCatalog, text, 2)
);

const findKnowledgeMatch = async (text) => knowledgeRetriever.retrieve(text, { limit: 3 });

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

const detectIntent = (message) => detectIntentMessage({
    message,
    topic: findTopic(message),
    operationTopics
});

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

const getActiveServices = async () => {
    const [services] = await pool.query(
        `SELECT id, name, price, duration, description
         FROM Services
         WHERE status = "active"
         ORDER BY name ASC
         LIMIT 100`
    );

    return services;
};

const getActiveDentists = async () => {
    const [dentists] = await pool.query(
        `SELECT id, fullName
         FROM Users
         WHERE role = "dentist" AND status = "active"
         ORDER BY fullName ASC`
    );

    return dentists;
};

const matchServicesFromText = (services, text) => {
    const normalized = normalizeText(text);
    const matched = services.filter((service) => {
        const serviceName = normalizeText(service.name);
        if (!serviceName) return false;
        if (normalized.includes(serviceName)) return true;

        const serviceWords = serviceName.split(' ').filter((word) => word.length >= 3);
        return serviceWords.length >= 2 && serviceWords.every((word) => normalized.includes(word));
    });

    if (matched.length > 0) return matched.slice(0, 4);

    const topic = findTopic(normalized);
    if (!topic) return [];

    return services.filter((service) => {
        const serviceText = normalizeText(`${service.name} ${service.description || ''}`);
        return topic.serviceHints.some((hint) => serviceText.includes(hint));
    }).slice(0, 2);
};

const isVagueClinicalTopic = (topic, text) => {
    if (!topic) return false;
    const normalized = normalizeText(text);
    if (['emergency', 'wisdom_tooth', 'root_canal', 'gum', 'braces', 'implant', 'whitening', 'cosmetic', 'children'].includes(topic.id)) {
        return false;
    }

    if (topic.id === 'toothache') {
        return !hasAny(normalized, [
            'sau rang',
            'lo sau',
            'e buot',
            'dau ve dem',
            'dau len dau',
            'sung',
            'rang khon',
            'chay mau',
            'me rang',
            'vo rang',
            'roi tram'
        ]);
    }

    return false;
};

const inferTopicFromTriage = (text) => {
    const normalized = normalizeText(text);
    if (hasAny(normalized, ['sung mat', 'sot', 'kho tho', 'kho nuot', 'chay mau khong cam', 'dau du doi'])) return 'emergency';
    if (hasAny(normalized, ['rang khon', 'cuoi ham', 'ham trong cung', 'moc rang'])) return 'wisdom_tooth';
    if (hasAny(normalized, ['dau ve dem', 'dau nhuc lien tuc', 'dau len dau', 'dau giat', 'buot lau'])) return 'root_canal';
    if (hasAny(normalized, ['chay mau chan rang', 'sung loi', 'hoi mieng', 'loi dau'])) return 'gum';
    if (hasAny(normalized, ['me rang', 'vo rang', 'nut rang', 'gay rang'])) return 'broken_tooth';
    if (hasAny(normalized, ['e buot', 'an nong', 'an lanh', 'lo sau', 'sau rang'])) return 'toothache';
    return '';
};

const getTopicById = (topicId) => topicCatalog.find((topic) => topic.id === topicId) || null;

const buildTriageQuestion = (topic) => (
    [
        `${topic?.answer || 'Mình cần hỏi thêm để định hướng đúng hơn trước khi đặt lịch.'}`,
        'Bạn mô tả thêm giúp mình 3 ý ngắn nhé:',
        '1. Đau ở răng/vị trí nào? Có phải răng khôn/cuối hàm không?',
        '2. Đau âm ỉ, ê buốt khi ăn nóng/lạnh, hay đau nhiều về đêm?',
        '3. Có sưng lợi/sưng mặt/sốt/chảy máu không?'
    ].join('\n')
);

const getPrimaryServicesForTopic = (services, topic) => {
    if (!topic) return [];
    return services.filter((service) => {
        const serviceText = normalizeText(`${service.name} ${service.description || ''}`);
        return topic.serviceHints.some((hint) => serviceText.includes(hint));
    }).slice(0, 2);
};

const matchDentistFromText = (dentists, text) => {
    const normalized = normalizeText(text);
    if (hasAny(normalized, ['bac si nao cung duoc', 'ai cung duoc', 'tu dong chon', 'chon giup', 'bat ky'])) {
        return { any: true, dentist: null };
    }

    const dentist = dentists.find((item) => {
        const fullName = normalizeText(item.fullName);
        if (normalized.includes(fullName)) return true;

        const words = fullName.split(' ').filter((word) => word.length >= 3);
        return words.length > 0 && words.every((word) => normalized.includes(word));
    });

    return { any: false, dentist: dentist || null };
};

const getDurationForServices = async (serviceIds) => {
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) return 30;
    const [rows] = await pool.query(
        'SELECT COALESCE(SUM(COALESCE(duration, 30)), 0) as totalDuration FROM Services WHERE id IN (?) AND status = "active"',
        [serviceIds]
    );
    return Math.max(Number(rows[0]?.totalDuration || 0), 30);
};

const isSlotInTimeWindow = (startMinutes, duration, timeWindow) => {
    if (!timeWindow) return true;
    const windowStart = Number(timeWindow.startMinutes);
    const windowEnd = Number(timeWindow.endMinutes);
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return true;
    return startMinutes >= windowStart && startMinutes + duration <= windowEnd;
};

const findSlotsForDentistDate = async ({ dentistId, date, serviceIds, limit = 8, timeWindow = null }) => {
    const duration = await getDurationForServices(serviceIds);
    const settings = await getSettings();
    const earliestBookable = getEarliestBookableDateTime(settings.bookingLeadHours);
    const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
    const [[schedule]] = await pool.query(
        `SELECT startTime, endTime, breakStart, breakEnd, slotIntervalMinutes, isActive
         FROM DoctorSchedules
         WHERE dentistId = ? AND dayOfWeek = ?
         LIMIT 1`,
        [dentistId, dayOfWeek]
    );

    if (!schedule || Number(schedule.isActive) !== 1) return [];

    const [daysOff] = await pool.query(
        'SELECT id FROM DoctorDaysOff WHERE dentistId = ? AND offDate = ? LIMIT 1',
        [dentistId, date]
    );
    if (daysOff.length > 0) return [];

    const busyRanges = await getBusyRanges(dentistId, date);
    const workStart = timeToMinutes(schedule.startTime);
    const workEnd = timeToMinutes(schedule.endTime);
    const breakStart = schedule.breakStart ? timeToMinutes(schedule.breakStart) : null;
    const breakEnd = schedule.breakEnd ? timeToMinutes(schedule.breakEnd) : null;
    const interval = Number(schedule.slotIntervalMinutes || 30);
    const slots = [];

    for (let minutes = workStart; minutes + duration <= workEnd && slots.length < limit; minutes += interval) {
        const slotEnd = minutes + duration;
        const time = minutesToTime(minutes);
        const dateTime = new Date(`${date}T${time}:00`);
        const inBreak = breakStart !== null && breakEnd !== null && rangesOverlap(minutes, slotEnd, breakStart, breakEnd);
        const isBooked = busyRanges.some((range) => rangesOverlap(minutes, slotEnd, range.start, range.end));

        if (dateTime >= earliestBookable && !inBreak && !isBooked && isSlotInTimeWindow(minutes, duration, timeWindow)) {
            slots.push({ time, date, dentistId });
        }
    }

    return slots;
};

const findDentistForExactSlot = async ({ dentists, date, time, serviceIds }) => {
    for (const dentist of dentists) {
        const slots = await findSlotsForDentistDate({ dentistId: dentist.id, date, serviceIds, limit: 40 });
        if (slots.some((slot) => slot.time === time)) return dentist;
    }

    return null;
};

const formatServicesForQuestion = (services) => (
    services.slice(0, 5).map((service, index) => (
        `${index + 1}. ${service.name}${service.duration ? ` (${service.duration} phút)` : ''}`
    )).join('\n')
);

const formatDentistsForQuestion = (dentists) => (
    dentists.slice(0, 5).map((dentist, index) => `${index + 1}. ${dentist.fullName}`).join('\n')
);

const bookingConfirmActions = () => [
    action('Xác nhận đặt lịch', 'message', 'Xác nhận đặt lịch'),
    action('Đổi ngày', 'message', 'Đổi ngày'),
    action('Đổi giờ', 'message', 'Đổi giờ'),
    action('Đổi bác sĩ', 'message', 'Đổi bác sĩ'),
    action('Hủy nháp', 'message', 'Hủy đặt lịch')
];

const buildDraftSummary = (draft, services, dentists) => {
    const serviceNames = services.filter((service) => draft.serviceIds?.includes(service.id)).map((service) => service.name).join(', ');
    const dentistName = dentists.find((dentist) => dentist.id === draft.dentistId)?.fullName || '';

    return [
        serviceNames ? `Dịch vụ: ${serviceNames}` : '',
        draft.triageTopicId ? `Định hướng: ${getTopicById(draft.triageTopicId)?.label || draft.triageTopicId}` : '',
        draft.appointmentDate ? `Ngày: ${formatDate(draft.appointmentDate)}` : '',
        draft.timeWindow?.label && !draft.appointmentTime ? `Khung giờ: ${draft.timeWindow.label}` : '',
        draft.appointmentTime ? `Giờ: ${draft.appointmentTime}` : '',
        dentistName ? `Bác sĩ: ${dentistName}` : ''
    ].filter(Boolean).join('\n');
};

const buildBookingResponse = async (message, { patientId, user }) => {
    if (!Number.isInteger(Number(patientId)) || Number(patientId) <= 0) return null;

    const text = normalizeText(message);
    const existingState = await getConversationAssistantState(patientId);
    const isInBookingFlow = existingState?.mode === 'booking';

    const bookingKeywords = knowledgeBase.find((item) => item.id === 'booking_flow')?.keywords || [];
    if (!isInBookingFlow && !isBookingStartIntent(text, bookingKeywords)) return null;

    if (isHumanSupportIntent(text)) {
        await clearConversationAssistantState(patientId);
        return {
            message: [
                'Mình đã ghi nhận bạn muốn gặp nhân viên hỗ trợ.',
                'Lễ tân/admin sẽ thấy hội thoại này trong nhóm cần xử lý và phản hồi cho bạn sớm.',
                'Hotline hỗ trợ nhanh: 0869 800 318.'
            ].join('\n'),
            metadata: {
                intent: 'human_support',
                needsStaff: true,
                priorityReason: 'Khách yêu cầu nhân viên hỗ trợ.',
                aiMode: 'local_booking',
                quickActions: [action('Đặt lịch thủ công', 'route', '/book-appointment')]
            },
            needsStaff: true,
            priorityReason: 'Khách yêu cầu nhân viên hỗ trợ.'
        };
    }

    if (isGenericConsultIntent(text, findTopic(text)) || isNewConsultationIntent(text)) {
        await clearConversationAssistantState(patientId);
        return {
            message: [
                'Bạn muốn tư vấn về vấn đề nào ạ?',
                'Bạn có thể mô tả triệu chứng hoặc dịch vụ quan tâm, ví dụ: đau răng, răng khôn, niềng răng, Implant, răng sứ, tẩy trắng, chi phí hoặc lịch trống.',
                'Nếu muốn gặp người thật, nhắn “gặp nhân viên” để mình chuyển lễ tân hỗ trợ.'
            ].join('\n'),
            metadata: {
                intent: 'consultation_clarify',
                aiMode: 'local_booking',
                quickActions: [
                    action('Gặp nhân viên', 'message', 'Tôi muốn gặp nhân viên hỗ trợ'),
                    action('Đặt lịch thủ công', 'route', '/book-appointment')
                ]
            },
            needsStaff: false,
            priorityReason: ''
        };
    }

    if (isCancelBookingDraft(text)) {
        await clearConversationAssistantState(patientId);
        return {
            message: 'Mình đã hủy nháp đặt lịch trong chat. Khi cần đặt lại, bạn chỉ cần nhắn “muốn đặt lịch”.',
            metadata: {
                intent: 'booking_cancelled',
                aiMode: 'local_booking',
                quickActions: [action('Đặt lịch thủ công', 'route', '/book-appointment')]
            },
            needsStaff: false,
            priorityReason: ''
        };
    }

    const services = await getActiveServices();
    const dentists = await getActiveDentists();
    const draft = createBookingDraft(existingState);
    const editIntent = detectBookingEditIntent(text);
    if (editIntent) {
        const editedDraft = applyBookingEdit(draft, editIntent);
        await saveConversationAssistantState(patientId, {
            mode: 'booking',
            draft: editedDraft,
            lastPrompt: editIntent,
            lastChoices: {},
            pendingConfirmation: false,
            updatedAt: new Date().toISOString()
        });

        const editLabels = {
            service: 'dịch vụ/triệu chứng',
            date: 'ngày khám',
            dentist: 'bác sĩ',
            time: 'giờ khám'
        };

        return {
            message: `Mình đã mở lại bước ${editLabels[editIntent]}. Bạn nhập thông tin mới giúp mình nhé.`,
            metadata: { intent: `booking_edit_${editIntent}`, aiMode: 'local_booking', quickActions: [action('Hủy nháp', 'message', 'Hủy đặt lịch')] },
            needsStaff: false,
            priorityReason: ''
        };
    }
    const lastChoices = existingState?.lastChoices || {};
    const choiceNumber = getChoiceNumber(message);

    if (choiceNumber && existingState?.lastPrompt === 'service' && !draft.serviceIds?.length) {
        const pickedService = pickNumberedChoice(lastChoices.services || [], choiceNumber);
        if (pickedService?.id) {
            draft.serviceIds = [Number(pickedService.id)];
        }
    }

    if (choiceNumber && existingState?.lastPrompt === 'dentist' && !draft.dentistId) {
        const pickedDentist = pickNumberedChoice(lastChoices.dentists || [], choiceNumber);
        if (pickedDentist?.id) {
            draft.dentistId = Number(pickedDentist.id);
            const accidentalChoiceTime = `${String(choiceNumber).padStart(2, '0')}:00`;
            if (draft.appointmentTimeSource === 'choice_number' || draft.appointmentTime === accidentalChoiceTime) {
                draft.appointmentTime = '';
                draft.appointmentTimeSource = '';
            }
        }
    }

    if (choiceNumber && existingState?.lastPrompt === 'time' && !draft.appointmentTime) {
        const pickedSlot = pickNumberedChoice(lastChoices.slots || [], choiceNumber);
        if (pickedSlot?.time) {
            draft.appointmentTime = pickedSlot.time;
            draft.appointmentTimeSource = 'slot_choice';
        }
    }

    const topicFromMessage = findTopic(message);
    if (!choiceNumber && topicFromMessage && isVagueClinicalTopic(topicFromMessage, message) && !draft.triageDone) {
        draft.triageTopicId = topicFromMessage.id;
        await saveConversationAssistantState(patientId, {
            mode: 'booking',
            draft,
            lastPrompt: 'triage',
            lastChoices: {},
            updatedAt: new Date().toISOString()
        });
        return {
            message: buildTriageQuestion(topicFromMessage),
            metadata: { intent: 'booking_triage', aiMode: 'local_booking', quickActions: [action('Hủy nháp', 'message', 'Hủy đặt lịch'), action('Gặp nhân viên', 'message', 'Tôi muốn gặp nhân viên hỗ trợ')] },
            needsStaff: false,
            priorityReason: ''
        };
    }

    if (existingState?.lastPrompt === 'triage') {
        const inferredTopicId = inferTopicFromTriage(message) || draft.triageTopicId;
        const inferredTopic = getTopicById(inferredTopicId);
        if (inferredTopic) {
            draft.triageTopicId = inferredTopic.id;
            draft.triageDone = true;
            const inferredServices = getPrimaryServicesForTopic(services, inferredTopic);
            if (inferredServices.length > 0) {
                draft.serviceIds = inferredServices.map((service) => service.id).slice(0, 2);
            }
            draft.notes = `Triệu chứng khách mô tả qua AI: ${String(message).slice(0, 400)}`;
        }
    }

    const matchedServices = matchServicesFromText(services, message);
    if (!choiceNumber && matchedServices.length > 0 && !draft.serviceIds?.length) {
        draft.serviceIds = [...new Set([...(draft.serviceIds || []), ...matchedServices.map((service) => service.id)])].slice(0, 4);
    }

    const requestedDate = parseRequestedDate(message);
    if (requestedDate) draft.appointmentDate = requestedDate;

    const requestedTimeWindow = parseRequestedTimeWindow(message);
    const requestedTime = choiceNumber && ['service', 'dentist', 'time'].includes(existingState?.lastPrompt)
        ? ''
        : ['after', 'before', 'range'].includes(requestedTimeWindow?.source)
            ? ''
            : parseRequestedTime(message);
    if (requestedTime) {
        draft.appointmentTime = requestedTime;
        draft.appointmentTimeSource = 'explicit';
        draft.timeWindow = null;
    } else if (requestedTimeWindow) {
        draft.appointmentTime = '';
        draft.appointmentTimeSource = '';
        draft.timeWindow = requestedTimeWindow;
    }

    const dentistMatch = matchDentistFromText(dentists, message);
    if (dentistMatch.dentist) draft.dentistId = dentistMatch.dentist.id;
    if (dentistMatch.any && draft.appointmentDate && draft.appointmentTime && draft.serviceIds.length > 0) {
        const autoDentist = await findDentistForExactSlot({
            dentists,
            date: draft.appointmentDate,
            time: draft.appointmentTime,
            serviceIds: draft.serviceIds
        });
        if (autoDentist) draft.dentistId = autoDentist.id;
    }

    const state = { mode: 'booking', draft, updatedAt: new Date().toISOString() };
    const baseActions = [
        action('Đặt lịch thủ công', 'route', '/book-appointment'),
        action('Hủy nháp', 'message', 'Hủy đặt lịch')
    ];

    if (!draft.serviceIds?.length) {
        const suggested = matchedServices.length ? matchedServices : services.slice(0, 5);
        await saveConversationAssistantState(patientId, {
            ...state,
            lastPrompt: 'service',
            lastChoices: {
                services: suggested.slice(0, 5).map((service) => ({ id: service.id, name: service.name }))
            }
        });
        return {
            message: [
                'Bạn muốn đặt lịch dịch vụ nào?',
                suggested.length ? `Một số dịch vụ đang có:\n${formatServicesForQuestion(suggested)}\nBạn có thể nhập số thứ tự hoặc tên dịch vụ.` : 'Bạn có thể nhắn tên dịch vụ hoặc triệu chứng, ví dụ: đau răng, răng khôn, niềng răng.'
            ].join('\n'),
            metadata: { intent: 'booking_collect_service', aiMode: 'local_booking', quickActions: baseActions },
            needsStaff: false,
            priorityReason: ''
        };
    }

    if (!draft.appointmentDate) {
        await saveConversationAssistantState(patientId, {
            ...state,
            lastPrompt: 'date',
            lastChoices: {}
        });
        return {
            message: [
                'Bạn muốn khám ngày nào?',
                'Bạn có thể nhắn theo dạng 10/07/2026, ngày mai, hoặc 2026-07-10.',
                buildDraftSummary(draft, services, dentists)
            ].filter(Boolean).join('\n'),
            metadata: { intent: 'booking_collect_date', aiMode: 'local_booking', quickActions: baseActions },
            needsStaff: false,
            priorityReason: ''
        };
    }

    if (!draft.dentistId) {
        await saveConversationAssistantState(patientId, {
            ...state,
            lastPrompt: 'dentist',
            lastChoices: {
                dentists: dentists.slice(0, 5).map((dentist) => ({ id: dentist.id, fullName: dentist.fullName }))
            }
        });
        return {
            message: [
                'Bạn muốn đặt với bác sĩ nào?',
                dentists.length ? formatDentistsForQuestion(dentists) : 'Hiện chưa có bác sĩ đang hoạt động để chọn.',
                'Bạn có thể nhập số thứ tự, tên bác sĩ, hoặc nhắn “bác sĩ nào cũng được” để mình tự chọn slot phù hợp.'
            ].join('\n'),
            metadata: { intent: 'booking_collect_dentist', aiMode: 'local_booking', quickActions: baseActions },
            needsStaff: false,
            priorityReason: ''
        };
    }

    if (!draft.appointmentTime) {
        const slots = await findSlotsForDentistDate({
            dentistId: draft.dentistId,
            date: draft.appointmentDate,
            serviceIds: draft.serviceIds,
            limit: 6,
            timeWindow: draft.timeWindow
        });
        await saveConversationAssistantState(patientId, {
            ...state,
            lastPrompt: 'time',
            lastChoices: {
                slots: slots.slice(0, 6).map((slot) => ({ time: slot.time, date: slot.date, dentistId: slot.dentistId }))
            }
        });
        return {
            message: [
                'Bạn muốn khám giờ nào?',
                slots.length
                    ? `Các giờ còn trống ngày ${formatDate(draft.appointmentDate)}${draft.timeWindow?.label ? ` trong ${draft.timeWindow.label}` : ''}:\n${slots.map((slot, index) => `${index + 1}. ${slot.time}`).join('\n')}\nBạn có thể nhập số thứ tự hoặc giờ cụ thể.`
                    : `Ngày này hiện chưa thấy giờ trống${draft.timeWindow?.label ? ` trong ${draft.timeWindow.label}` : ''} với bác sĩ đã chọn. Bạn có thể đổi ngày, đổi khung giờ hoặc đổi bác sĩ.`
            ].join('\n'),
            metadata: { intent: 'booking_collect_time', aiMode: 'local_booking', quickActions: baseActions },
            needsStaff: false,
            priorityReason: ''
        };
    }

    if (!existingState?.pendingConfirmation || !isBookingConfirmIntent(text)) {
        await saveConversationAssistantState(patientId, {
            ...state,
            lastPrompt: 'confirm',
            lastChoices: {},
            pendingConfirmation: true
        });

        return {
            message: [
                'Mình đã có đủ thông tin. Bạn kiểm tra lại giúp mình:',
                buildDraftSummary(draft, services, dentists),
                '',
                'Nếu đúng, nhắn “xác nhận” để mình tạo lịch hẹn.',
                'Nếu muốn sửa, bạn nhắn: đổi dịch vụ, đổi ngày, đổi bác sĩ hoặc đổi giờ.'
            ].join('\n'),
            metadata: {
                intent: 'booking_confirm',
                aiMode: 'local_booking',
                quickActions: bookingConfirmActions()
            },
            needsStaff: false,
            priorityReason: ''
        };
    }

    try {
        const { appointmentId } = await createAppointmentFromChat({
            actor: user,
            patientId,
            dentistId: draft.dentistId,
            appointmentDate: draft.appointmentDate,
            appointmentTime: draft.appointmentTime,
            notes: `Đặt qua AI chatbox.${draft.notes ? ` ${draft.notes}` : message ? ` Ghi chú khách: ${String(message).slice(0, 300)}` : ''}`,
            serviceIds: draft.serviceIds,
            sourceNote: 'AI chatbox tạo lịch hẹn'
        });
        await clearConversationAssistantState(patientId);

        return {
            message: [
                `Đặt lịch thành công. Mã lịch hẹn: #${appointmentId}.`,
                buildDraftSummary(draft, services, dentists),
                'Lịch đang ở trạng thái chờ xác nhận. Lễ tân sẽ kiểm tra và xác nhận trước khi bạn đến.',
                'Hotline hỗ trợ: 0869 800 318.'
            ].join('\n'),
            metadata: {
                intent: 'booking_created',
                appointmentId,
                aiMode: 'local_booking',
                quickActions: [
                    action('Xem lịch hẹn', 'route', '/profile?tab=appointments'),
                    action('Gặp nhân viên', 'message', 'Tôi muốn gặp nhân viên hỗ trợ')
                ]
            },
            needsStaff: false,
            priorityReason: ''
        };
    } catch (error) {
        await saveConversationAssistantState(patientId, state);
        const slots = draft.dentistId && draft.appointmentDate
            ? await findSlotsForDentistDate({
                dentistId: draft.dentistId,
                date: draft.appointmentDate,
                serviceIds: draft.serviceIds,
                limit: 5,
                timeWindow: draft.timeWindow
            })
            : [];

        return {
            message: [
                `Mình chưa đặt được lịch vì: ${publicBookingError(error)}`,
                slots.length ? `Bạn có thể chọn một giờ trống khác:\n${slots.map((slot, index) => `${index + 1}. ${slot.time}`).join('\n')}` : 'Bạn có thể đổi ngày, giờ hoặc bác sĩ để mình thử lại.'
            ].join('\n'),
            metadata: { intent: 'booking_failed', aiMode: 'local_booking', quickActions: baseActions },
            needsStaff: false,
            priorityReason: ''
        };
    }
};

const getPatientAppointments = async (patientId, scope = 'upcoming') => {
    if (!Number.isInteger(Number(patientId)) || Number(patientId) <= 0) return [];

    const whereByScope = {
        upcoming: 'AND a.status IN ("pending", "confirmed", "arrived", "in_progress") AND TIMESTAMP(a.appointmentDate, a.appointmentTime) >= NOW()',
        all: 'AND a.status <> "cancelled"',
        completed: 'AND a.status = "completed"',
        cancelled: 'AND a.status = "cancelled"',
        past: 'AND TIMESTAMP(a.appointmentDate, a.appointmentTime) < NOW()'
    }[scope] || 'AND a.status IN ("pending", "confirmed", "arrived", "in_progress") AND TIMESTAMP(a.appointmentDate, a.appointmentTime) >= NOW()';

    const orderByScope = scope === 'upcoming'
        ? 'ORDER BY a.appointmentDate ASC, a.appointmentTime ASC'
        : 'ORDER BY a.appointmentDate DESC, a.appointmentTime DESC';

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
           ${whereByScope}
         GROUP BY a.id, a.appointmentDate, a.appointmentTime, a.status, dentist.fullName
         ${orderByScope}
         LIMIT 5`,
        [patientId]
    );

    return rows;
};

const getPatientInvoices = async (patientId, scope = 'open') => {
    if (!Number.isInteger(Number(patientId)) || Number(patientId) <= 0) return [];

    const statusClause = scope === 'paid'
        ? 'AND i.status = "paid"'
        : scope === 'all'
            ? 'AND i.status <> "cancelled"'
            : 'AND i.status IN ("unpaid", "partial")';

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
           ${statusClause}
         GROUP BY i.id, i.totalAmount, i.paidAmount, i.status, i.paymentMethod, a.appointmentDate
         ORDER BY i.createdAt DESC
         LIMIT 5`,
        [patientId]
    );

    return rows;
};

const getPatientMedicalRecords = async (patientId) => {
    if (!Number.isInteger(Number(patientId)) || Number(patientId) <= 0) return [];

    const [rows] = await pool.query(
        `SELECT
            m.id,
            m.appointmentId,
            m.diagnosis,
            m.chiefComplaint,
            m.treatmentPlan,
            m.procedures,
            m.prescription,
            m.notes,
            m.nextAppointmentDate,
            m.nextAppointmentNote,
            m.createdAt,
            a.appointmentDate,
            a.appointmentTime,
            dentist.fullName as dentistName,
            GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') as serviceNames
         FROM MedicalRecords m
         JOIN Appointments a ON a.id = m.appointmentId
         LEFT JOIN Users dentist ON dentist.id = m.dentistId
         LEFT JOIN Appointment_Services aps ON aps.appointmentId = a.id
         LEFT JOIN Services s ON s.id = aps.serviceId
         WHERE m.patientId = ?
         GROUP BY
            m.id, m.appointmentId, m.diagnosis, m.chiefComplaint, m.treatmentPlan,
            m.procedures, m.prescription, m.notes, m.nextAppointmentDate,
            m.nextAppointmentNote, m.createdAt, a.appointmentDate,
            a.appointmentTime, dentist.fullName
         ORDER BY a.appointmentDate DESC, a.appointmentTime DESC, m.createdAt DESC
         LIMIT 5`,
        [patientId]
    );

    return rows;
};

const getPatientFollowUps = async (patientId) => {
    if (!Number.isInteger(Number(patientId)) || Number(patientId) <= 0) return [];

    const [rows] = await pool.query(
        `SELECT
            m.id,
            m.appointmentId,
            m.diagnosis,
            m.nextAppointmentDate,
            m.nextAppointmentNote,
            a.appointmentDate,
            a.appointmentTime,
            dentist.fullName as dentistName,
            GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') as serviceNames
         FROM MedicalRecords m
         JOIN Appointments a ON a.id = m.appointmentId
         LEFT JOIN Users dentist ON dentist.id = m.dentistId
         LEFT JOIN Appointment_Services aps ON aps.appointmentId = a.id
         LEFT JOIN Services s ON s.id = aps.serviceId
         WHERE m.patientId = ?
           AND m.nextAppointmentDate IS NOT NULL
           AND m.nextAppointmentDate >= CURDATE()
         GROUP BY
            m.id, m.appointmentId, m.diagnosis, m.nextAppointmentDate,
            m.nextAppointmentNote, a.appointmentDate, a.appointmentTime,
            dentist.fullName
         ORDER BY m.nextAppointmentDate ASC
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

const buildPatientAppointmentTextByScope = (appointments, scope = 'upcoming') => {
    const emptyText = {
        upcoming: 'Hiện mình chưa thấy lịch hẹn sắp tới nào trong tài khoản của bạn.',
        all: 'Hiện mình chưa thấy lịch khám nào trong tài khoản của bạn.',
        completed: 'Hiện mình chưa thấy lịch khám đã hoàn thành trong tài khoản của bạn.',
        cancelled: 'Hiện mình chưa thấy lịch khám đã hủy trong tài khoản của bạn.',
        past: 'Hiện mình chưa thấy lịch khám trong quá khứ trong tài khoản của bạn.'
    }[scope] || 'Hiện mình chưa thấy lịch hẹn phù hợp trong tài khoản của bạn.';

    if (!appointments.length) return emptyText;

    const statusLabels = {
        pending: 'chờ xác nhận',
        confirmed: 'đã xác nhận',
        arrived: 'đã đến',
        in_progress: 'đang khám',
        completed: 'hoàn thành',
        cancelled: 'đã hủy',
        no_show: 'không đến'
    };

    const title = {
        upcoming: 'Lịch hẹn sắp tới của bạn:',
        all: 'Các lịch khám gần đây của bạn:',
        completed: 'Các lịch khám đã hoàn thành của bạn:',
        cancelled: 'Các lịch khám đã hủy của bạn:',
        past: 'Các lịch khám trong quá khứ của bạn:'
    }[scope] || 'Các lịch khám của bạn:';

    return [
        title,
        ...appointments.map((appointment, index) => (
            `${index + 1}. #${appointment.id} - ${String(appointment.appointmentTime).slice(0, 5)} ngày ${formatDate(appointment.appointmentDate)}`
            + `${appointment.dentistName ? ` với ${appointment.dentistName}` : ''}`
            + `${appointment.serviceNames ? `, dịch vụ: ${appointment.serviceNames}` : ''}`
            + ` (${statusLabels[appointment.status] || appointment.status}).`
        ))
    ].join('\n');
};

const buildPatientInvoiceTextByScope = (invoices, scope = 'open') => {
    if (!invoices.length) {
        if (scope === 'paid') return 'Hiện mình chưa thấy hóa đơn đã thanh toán trong tài khoản của bạn.';
        if (scope === 'all') return 'Hiện mình chưa thấy hóa đơn nào trong tài khoản của bạn.';
        return 'Hiện mình chưa thấy hóa đơn chưa thanh toán trong tài khoản của bạn.';
    }

    if (scope === 'paid') {
        return [
            'Các hóa đơn đã thanh toán của bạn:',
            ...invoices.map((invoice, index) => {
                const total = Number(invoice.totalAmount || 0).toLocaleString('vi-VN');
                return `${index + 1}. INV-${invoice.id}: đã thanh toán ${total} đ`
                    + `${invoice.itemNames ? `, nội dung: ${invoice.itemNames}` : ''}.`;
            }),
            'Bạn có thể mở tab Hóa đơn để xem chi tiết hoặc in/PDF nếu hệ thống hỗ trợ.'
        ].join('\n');
    }

    if (scope === 'all') {
        return [
            'Các hóa đơn gần đây của bạn:',
            ...invoices.map((invoice, index) => {
                const outstanding = Number(invoice.outstandingAmount || 0).toLocaleString('vi-VN');
                const total = Number(invoice.totalAmount || 0).toLocaleString('vi-VN');
                const statusText = invoice.status === 'paid'
                    ? 'đã thanh toán'
                    : invoice.status === 'partial'
                        ? `còn ${outstanding} đ`
                        : 'chưa thanh toán';
                return `${index + 1}. INV-${invoice.id}: ${statusText} / tổng ${total} đ`
                    + `${invoice.itemNames ? `, nội dung: ${invoice.itemNames}` : ''}.`;
            })
        ].join('\n');
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

const buildPatientMedicalRecordText = (records) => {
    if (!records.length) {
        return 'Hiện mình chưa thấy hồ sơ khám nào trong tài khoản của bạn. Nếu bạn vừa khám xong, bác sĩ có thể chưa hoàn tất ghi hồ sơ.';
    }

    return [
        'Hồ sơ khám gần đây của bạn:',
        ...records.map((record, index) => {
            const lines = [
                `${index + 1}. Hồ sơ #${record.id} - lịch #${record.appointmentId}, ngày ${formatDate(record.appointmentDate)}${record.appointmentTime ? ` lúc ${String(record.appointmentTime).slice(0, 5)}` : ''}.`,
                record.dentistName ? `Bác sĩ: ${record.dentistName}.` : '',
                record.serviceNames ? `Dịch vụ: ${record.serviceNames}.` : '',
                record.chiefComplaint ? `Lý do khám: ${record.chiefComplaint}.` : '',
                record.diagnosis ? `Chẩn đoán: ${record.diagnosis}.` : '',
                record.treatmentPlan ? `Kế hoạch: ${record.treatmentPlan}.` : '',
                record.procedures ? `Đã thực hiện: ${record.procedures}.` : '',
                record.prescription ? `Đơn thuốc/dặn dò: ${record.prescription}.` : '',
                record.nextAppointmentDate ? `Tái khám: ${formatDate(record.nextAppointmentDate)}${record.nextAppointmentNote ? ` - ${record.nextAppointmentNote}` : ''}.` : ''
            ].filter(Boolean);

            return lines.join('\n');
        })
    ].join('\n\n');
};

const buildPatientFollowUpText = (records) => {
    if (!records.length) {
        return 'Hiện mình chưa thấy lịch tái khám sắp tới trong hồ sơ của bạn.';
    }

    return [
        'Lịch tái khám được ghi trong hồ sơ của bạn:',
        ...records.map((record, index) => (
            `${index + 1}. ${formatDate(record.nextAppointmentDate)} - từ hồ sơ #${record.id}`
            + `${record.dentistName ? `, bác sĩ phụ trách: ${record.dentistName}` : ''}`
            + `${record.diagnosis ? `, chẩn đoán lần trước: ${record.diagnosis}` : ''}`
            + `${record.nextAppointmentNote ? `, ghi chú: ${record.nextAppointmentNote}` : ''}.`
        )),
        'Bạn có thể đặt lịch tái khám theo ngày trên, hoặc nhắn mình ngày/giờ mong muốn để hỗ trợ đặt lịch.'
    ].join('\n');
};

const buildPatientOverviewText = ({ appointments, invoices, followUps }) => {
    const lines = ['Tổng quan tài khoản của bạn:'];

    if (appointments.length) {
        const next = appointments[0];
        lines.push(`- Lịch gần nhất: #${next.id} lúc ${String(next.appointmentTime).slice(0, 5)} ngày ${formatDate(next.appointmentDate)}${next.dentistName ? ` với ${next.dentistName}` : ''}.`);
    } else {
        lines.push('- Chưa có lịch hẹn sắp tới.');
    }

    if (followUps.length) {
        lines.push(`- Tái khám gần nhất cần chú ý: ${formatDate(followUps[0].nextAppointmentDate)} từ hồ sơ #${followUps[0].id}.`);
    }

    if (invoices.length) {
        const totalOutstanding = invoices.reduce((sum, invoice) => sum + Number(invoice.outstandingAmount || 0), 0);
        lines.push(`- Hóa đơn chưa thanh toán: ${invoices.length}, còn tổng ${totalOutstanding.toLocaleString('vi-VN')} đ.`);
    } else {
        lines.push('- Không có hóa đơn chưa thanh toán.');
    }

    return lines.join('\n');
};

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
    } else if ((intent.isBooking || intent.isSlot || intent.isDoctor) && !intent.isOpening) {
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

const buildFocusedReply = async (message, preloadedKnowledgeResult = null) => {
    const intent = detectIntent(message);
    const settings = await getSettings();
    const knowledgeResult = preloadedKnowledgeResult || await findKnowledgeMatch(message);
    const knowledge = knowledgeResult.bestMatch;
    const lines = [];
    const groundingSources = [];
    const addGroundingSource = (source) => {
        if (!source?.id || groundingSources.some((item) => item.id === source.id && item.source === source.source)) return;
        groundingSources.push(source);
    };

    if (intent.isClinical) {
        addGroundingSource(toSourceMetadata({
            id: intent.topic.id,
            source: 'builtin_topic',
            title: intent.topic.label,
            category: 'clinical',
            score: intent.confidence,
            matchedSignals: intent.matchedSignals
        }));
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
        addGroundingSource({ id: 'payment_policy', source: 'system_rule', title: 'Thanh toán', category: 'payment', score: intent.confidence });
        lines.push('Bạn có thể thanh toán bằng tiền mặt, thẻ/chuyển khoản hoặc VNPay QR nếu hóa đơn hỗ trợ.');
        lines.push('Với VNPay QR, trạng thái hóa đơn sẽ đổi khi hệ thống nhận kết quả thanh toán thành công.');
    } else if (intent.isReschedule) {
        addGroundingSource({ id: 'appointment_policy', source: 'system_rule', title: 'Đổi và hủy lịch', category: 'appointment', score: intent.confidence });
        lines.push('Bạn có thể đổi/hủy lịch trong phần Hồ sơ > Lịch hẹn nếu còn trong thời gian cho phép.');
        lines.push('Nếu cần đổi bác sĩ hoặc lịch đã xác nhận, lễ tân/admin sẽ kiểm tra và duyệt.');
    } else if (intent.isProfile) {
        addGroundingSource({ id: 'medical_record_policy', source: 'system_rule', title: 'Hồ sơ khám', category: 'medical_record', score: intent.confidence });
        lines.push('Hồ sơ khám dùng để xem lịch sử khám, chẩn đoán, kế hoạch điều trị, tái khám và hóa đơn liên quan.');
        lines.push('Nếu vừa khám xong mà chưa thấy hồ sơ, bác sĩ có thể chưa hoàn tất ghi hồ sơ.');
    } else if (intent.isProcedure) {
        addGroundingSource({ id: 'clinic_settings', source: 'settings', title: 'Thông tin phòng khám', category: 'clinic', score: intent.confidence });
        lines.push(`Quy trình khi đến ${settings.clinicName}:`);
        lines.push('1. Gặp lễ tân để check-in và xác nhận lịch.');
        lines.push('2. Chờ điều phối vào phòng khám theo bác sĩ phụ trách.');
        lines.push('3. Bác sĩ khám/tư vấn, sau đó lễ tân hỗ trợ thanh toán và tái khám nếu có.');
        lines.push('');
        lines.push(`Địa chỉ: ${settings.address}.`);
        if (settings.mapUrl) lines.push(`Bản đồ: ${settings.mapUrl}`);
        lines.push(`Hotline hỗ trợ: ${settings.phone}.`);
    } else if ((intent.isBooking || intent.isSlot || intent.isDoctor) && !intent.isOpening) {
        addGroundingSource({ id: 'appointment_availability', source: 'database', title: 'Lịch làm việc và slot trống', category: 'appointment', score: intent.confidence });
        if (intent.isSlot || intent.isDoctor) {
            await appendSuggestedSlots(lines, null, 5);
            lines.push('Sau khi đặt online, lễ tân sẽ xác nhận lịch.');
        } else {
            lines.push('Bấm Đặt lịch ngay, chọn dịch vụ, bác sĩ, ngày giờ rồi gửi yêu cầu.');
            lines.push('Sau khi lịch được xác nhận, hệ thống/lễ tân sẽ hướng dẫn thông tin đến khám.');
        }
    } else if (intent.isService) {
        addGroundingSource({ id: 'active_services', source: 'database', title: 'Dịch vụ đang hoạt động', category: 'service', score: intent.confidence });
        lines.push('Dịch vụ đang hoạt động:');
        lines.push(buildServiceText(await getRelevantServices(null, intent.text)) || 'Chưa có dịch vụ phù hợp đang hiển thị.');
        lines.push('Giá có thể thay đổi theo tình trạng thực tế sau khi bác sĩ khám.');
    } else if (intent.isOpening) {
        addGroundingSource({ id: 'clinic_settings', source: 'settings', title: 'Thông tin phòng khám', category: 'clinic', score: intent.confidence });
        lines.push(`${settings.clinicName} làm việc: ${settings.openingHours}.`);
        lines.push(`Hotline: ${settings.phone}.`);
    } else if (intent.isGreeting) {
        lines.push(`Chào bạn, mình là ${ASSISTANT_NAME}.`);
        lines.push('Bạn cần tư vấn dịch vụ, xem lịch trống hay kiểm tra lịch/hóa đơn của mình?');
    } else if (knowledge) {
        knowledgeResult.sources.forEach(addGroundingSource);
        lines.push(knowledge.answer);
        if (knowledge.id === 'booking_flow') {
            lines.push('Bạn nhắn giúp mình dịch vụ/triệu chứng muốn khám trước nhé.');
        }
    } else {
        lines.push('Bạn mô tả rõ hơn triệu chứng hoặc dịch vụ muốn làm nhé. Mình sẽ gợi ý đúng hơn.');
    }

    if (intent.isClinical) {
        lines.push('');
        lines.push('Thông tin này chỉ mang tính định hướng; chẩn đoán chính thức cần bác sĩ thăm khám.');
    }

    return {
        text: lines.join('\n').trim(),
        groundingSources,
        groundingConfidence: groundingSources.length
            ? Math.max(...groundingSources.map((source) => Number(source.score || 0)))
            : 0,
        resolvedIntent: knowledge && !intent.isClinical && intent.primaryIntent === 'general'
            ? `knowledge_${knowledge.category || 'general'}`
            : intent.primaryIntent
    };
};

const buildAssistantResponse = async (message, context = {}) => {
    const patientId = Number(context.patientId || context.user?.id || 0);
    let effectiveMessage = message;
    let dialogueState = patientId > 0 ? await getConversationAssistantState(patientId) : null;

    if (dialogueState?.mode === 'intent_clarification') {
        const resolved = resolveIntentClarification(dialogueState, message);
        if (resolved) {
            effectiveMessage = resolved.canonicalMessage;
            await clearConversationAssistantState(patientId);
            dialogueState = null;
        } else {
            return {
                message: [
                    'Mình chưa xác định được lựa chọn của bạn. Bạn chọn một mục bằng số hoặc tên nhé:',
                    ...(dialogueState.options || []).map((option, index) => `${index + 1}. ${option.label}`)
                ].join('\n'),
                metadata: attachQualityTelemetry({
                    intent: 'intent_clarification',
                    confidence: 0.2,
                    detectedIntents: [],
                    expectedEntity: 'intent',
                    groundingSources: [],
                    groundingConfidence: 0,
                    grounded: false,
                    aiMode: 'local',
                    quickActions: (dialogueState.options || []).slice(0, 4).map((option) => action(option.label, 'message', option.label))
                }),
                needsStaff: false,
                priorityReason: ''
            };
        }
    }

    const text = normalizeText(effectiveMessage);
    const intent = detectIntent(effectiveMessage);
    const personalIntent = detectPersonalIntent(text);
    const appointmentScope = detectAppointmentScope(text);
    const invoiceScope = detectInvoiceScope(text);
    const settings = await getSettings();
    const quickActions = commonActions(settings);
    let responseText = '';
    let needsStaff = false;
    let priorityReason = '';
    let groundingSources = [];
    let groundingConfidence = 0;
    let resolvedIntent = '';
    const hasPersonalDataIntent = personalIntent.overview
        || personalIntent.followUp
        || personalIntent.record
        || personalIntent.appointment
        || personalIntent.invoice;
    const preloadedKnowledgeResult = intent.primaryIntent === 'general' && !hasPersonalDataIntent
        ? await findKnowledgeMatch(effectiveMessage)
        : null;

    if (shouldClarifyIntent(intent, {
        isInBookingFlow: dialogueState?.mode === 'booking',
        hasPersonalDataIntent
    }) && !preloadedKnowledgeResult?.bestMatch && patientId > 0) {
        const clarificationState = createIntentClarificationState(effectiveMessage);
        await saveConversationAssistantState(patientId, clarificationState);
        return {
            message: [
                'Mình chưa chắc bạn đang muốn thực hiện việc nào. Bạn chọn giúp mình nhé:',
                ...clarificationState.options.map((option, index) => `${index + 1}. ${option.label}`)
            ].join('\n'),
            metadata: attachQualityTelemetry({
                intent: 'intent_clarification',
                confidence: intent.confidence,
                detectedIntents: intent.detectedIntents,
                matchedSignals: intent.matchedSignals,
                expectedEntity: 'intent',
                groundingSources: [],
                groundingConfidence: 0,
                grounded: false,
                aiMode: 'local',
                quickActions: clarificationState.options.slice(0, 4).map((option) => action(option.label, 'message', option.label))
            }),
            needsStaff: false,
            priorityReason: ''
        };
    }

    if (!hasPersonalDataIntent) {
        const bookingResponse = await buildBookingResponse(effectiveMessage, { patientId, user: context.user || { id: patientId, role: 'patient' } });
        if (bookingResponse) {
            bookingResponse.metadata = attachQualityTelemetry({
                ...bookingResponse.metadata,
                groundingSources: [{
                    id: 'appointment_booking_flow',
                    source: 'database_system',
                    title: 'Quy trình, dịch vụ, bác sĩ và slot đặt lịch',
                    category: 'appointment',
                    score: 1
                }],
                groundingConfidence: 1,
                grounded: true
            });
            return bookingResponse;
        }
    }

    if (personalIntent.overview && patientId > 0) {
        const [appointments, invoices, followUps] = await Promise.all([
            getPatientAppointments(patientId),
            getPatientInvoices(patientId),
            getPatientFollowUps(patientId)
        ]);
        responseText = buildPatientOverviewText({ appointments, invoices, followUps });
        groundingSources = [{ id: 'patient_overview', source: 'database', title: 'Dữ liệu tổng quan của khách hàng', category: 'personal', score: 1 }];
        groundingConfidence = 1;
        quickActions.unshift(action('Mở hồ sơ', 'route', '/profile'));
    } else if (hasPersonalDataIntent && patientId > 0) {
        const sections = [];
        if (personalIntent.followUp) {
            const followUps = await getPatientFollowUps(patientId);
            sections.push(buildPatientFollowUpText(followUps));
            quickActions.unshift(action('Đặt tái khám', 'route', '/book-appointment'));
            quickActions.unshift(action('Mở hồ sơ khám', 'route', '/profile?tab=history'));
        }
        if (personalIntent.record) {
            const records = await getPatientMedicalRecords(patientId);
            sections.push(buildPatientMedicalRecordText(records));
            quickActions.unshift(action('Mở hồ sơ khám', 'route', '/profile?tab=history'));
        }
        if (personalIntent.appointment) {
            const appointments = await getPatientAppointments(patientId, appointmentScope);
            sections.push(buildPatientAppointmentTextByScope(appointments, appointmentScope));
            quickActions.unshift(action('Mở lịch hẹn', 'route', '/profile?tab=appointments'));
        }
        if (personalIntent.invoice) {
            const invoices = await getPatientInvoices(patientId, invoiceScope);
            sections.push(buildPatientInvoiceTextByScope(invoices, invoiceScope));
            quickActions.unshift(action('Mở hóa đơn', 'route', '/profile?tab=invoices'));
        }
        responseText = sections.join('\n\n');
        if (personalIntent.followUp) groundingSources.push({ id: 'patient_followups', source: 'database', title: 'Lịch tái khám', category: 'personal', score: 1 });
        if (personalIntent.record) groundingSources.push({ id: 'patient_records', source: 'database', title: 'Hồ sơ khám', category: 'personal', score: 1 });
        if (personalIntent.appointment) groundingSources.push({ id: 'patient_appointments', source: 'database', title: 'Lịch hẹn của khách hàng', category: 'personal', score: 1 });
        if (personalIntent.invoice) groundingSources.push({ id: 'patient_invoices', source: 'database', title: 'Hóa đơn của khách hàng', category: 'personal', score: 1 });
        groundingConfidence = groundingSources.length ? 1 : 0;
    } else {
        const focusedReply = await buildFocusedReply(effectiveMessage, preloadedKnowledgeResult);
        responseText = focusedReply.text;
        groundingSources = focusedReply.groundingSources;
        groundingConfidence = focusedReply.groundingConfidence;
        resolvedIntent = focusedReply.resolvedIntent;
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
        intent: personalIntent.overview ? 'patient_overview'
            : personalIntent.followUp ? 'patient_followups'
                : personalIntent.record ? 'patient_medical_records'
                    : personalIntent.appointment ? 'patient_appointments'
                        : personalIntent.invoice ? 'patient_invoices'
                            : personalIntent.human ? 'human_support'
                                : resolvedIntent || intent.primaryIntent || intent.topic?.id || 'general',
        needsStaff,
        priorityReason,
        confidence: intent.confidence,
        detectedIntents: intent.detectedIntents,
        matchedSignals: intent.matchedSignals,
        entities: intent.entities,
        groundingSources,
        groundingConfidence,
        grounded: groundingSources.length > 0,
        quickActions: quickActions.slice(0, 4),
        aiMode: getAiConfig().enabled ? 'external' : 'local'
    };
    metadata.needsTrainingReview = metadata.intent === 'general' && !metadata.grounded && !intent.isGreeting && !personalIntent.human;
    metadata.trainingReason = metadata.needsTrainingReview
        ? 'AI chưa xác định được intent rõ ràng hoặc chưa có tri thức phù hợp.'
        : '';

    try {
        const isPersonalDataReply = [
            'patient_overview',
            'patient_followups',
            'patient_medical_records',
            'patient_appointments',
            'patient_invoices'
        ].includes(metadata.intent);

        const aiReply = isPersonalDataReply || !metadata.grounded ? null : await generateAiReply({
            userMessage: effectiveMessage,
            draftReply: responseText,
            settings,
            metadata
        });

        if (aiReply) {
            responseText = aiReply;
            metadata.aiMode = 'external';
        }
    } catch (error) {
        console.warn('AI chat fallback:', error.message);
        metadata.aiMode = 'local_fallback';
    }

    return {
        message: responseText,
        metadata: attachQualityTelemetry(metadata),
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
