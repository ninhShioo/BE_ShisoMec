const https = require('https');

const toBool = (value) => value === true || value === 'true' || value === '1' || value === 1;

const isZaloEnabled = () => (
    toBool(process.env.ZALO_REMINDER_ENABLED)
    && Boolean(process.env.ZALO_OA_ACCESS_TOKEN)
);

const getZaloMessageUrl = () => process.env.ZALO_MESSAGE_URL || 'https://openapi.zalo.me/v3.0/oa/message/cs';

const postJson = (url, body, headers = {}) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const target = new URL(url);

    const request = https.request({
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            ...headers
        },
        timeout: Number(process.env.ZALO_TIMEOUT_MS || 10000)
    }, (response) => {
        let raw = '';
        response.on('data', (chunk) => {
            raw += chunk;
        });
        response.on('end', () => {
            let data = raw;
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch {
                data = { raw };
            }

            if (response.statusCode >= 200 && response.statusCode < 300) {
                resolve(data);
                return;
            }

            reject(new Error(`Zalo API ${response.statusCode}: ${raw || response.statusMessage}`));
        });
    });

    request.on('timeout', () => {
        request.destroy(new Error('Zalo API timeout'));
    });
    request.on('error', reject);
    request.write(payload);
    request.end();
});

const formatAppointmentDateTime = (appointment) => {
    const date = appointment.appointmentDate
        ? new Date(appointment.appointmentDate).toLocaleDateString('vi-VN')
        : '';
    const time = String(appointment.appointmentTime || '').slice(0, 5);
    return `${date}${time ? ` lúc ${time}` : ''}`;
};

const sendZaloTextMessage = async (zaloUserId, text) => {
    if (!isZaloEnabled() || !zaloUserId) {
        return { skipped: true, reason: 'zalo_not_configured' };
    }

    const response = await postJson(
        getZaloMessageUrl(),
        {
            recipient: { user_id: String(zaloUserId) },
            message: { text }
        },
        {
            access_token: process.env.ZALO_OA_ACCESS_TOKEN
        }
    );

    return { skipped: false, response };
};

const sendAppointmentReminderZalo = async (appointment) => {
    const clinicName = process.env.CLINIC_NAME || 'Phenikaa Dental';
    const appointmentTime = formatAppointmentDateTime(appointment);
    const lines = [
        `${clinicName} nhắc lịch hẹn nha khoa #${appointment.id}.`,
        `Thời gian: ${appointmentTime}.`,
        appointment.dentistName ? `Bác sĩ: ${appointment.dentistName}.` : '',
        appointment.serviceNames ? `Dịch vụ: ${appointment.serviceNames}.` : '',
        'Bạn vui lòng đến sớm vài phút để lễ tân hỗ trợ check-in.'
    ].filter(Boolean);

    return sendZaloTextMessage(appointment.patientZaloUserId, lines.join('\n'));
};

const sendFollowUpReminderZalo = async (record) => {
    const clinicName = process.env.CLINIC_NAME || 'Phenikaa Dental';
    const followUpDate = record.nextAppointmentDate
        ? new Date(record.nextAppointmentDate).toLocaleDateString('vi-VN')
        : '';
    const lines = [
        `${clinicName} nhắc lịch tái khám.`,
        followUpDate ? `Ngày tái khám: ${followUpDate}.` : '',
        record.dentistName ? `Bác sĩ phụ trách hồ sơ: ${record.dentistName}.` : '',
        record.nextAppointmentNote ? `Ghi chú: ${record.nextAppointmentNote}.` : '',
        'Bạn có thể đăng nhập tài khoản để xem hồ sơ hoặc đặt lịch tái khám phù hợp.'
    ].filter(Boolean);

    return sendZaloTextMessage(record.patientZaloUserId, lines.join('\n'));
};

module.exports = {
    isZaloEnabled,
    sendZaloTextMessage,
    sendAppointmentReminderZalo,
    sendFollowUpReminderZalo
};
