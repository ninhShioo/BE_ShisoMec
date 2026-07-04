let nodemailer = null;

try {
    nodemailer = require('nodemailer');
} catch {
    nodemailer = null;
}

const toBool = (value) => value === true || value === 'true' || value === '1' || value === 1;

const isEmailEnabled = () => (
    toBool(process.env.EMAIL_REMINDER_ENABLED)
    && Boolean(process.env.SMTP_HOST)
    && Boolean(process.env.SMTP_USER)
    && Boolean(process.env.SMTP_PASS)
    && Boolean(nodemailer)
);

let transporter = null;

const getTransporter = () => {
    if (!isEmailEnabled()) return null;
    if (transporter) return transporter;

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: toBool(process.env.SMTP_SECURE),
        connectionTimeout: Number(process.env.SMTP_TIMEOUT_MS || 10000),
        greetingTimeout: Number(process.env.SMTP_TIMEOUT_MS || 10000),
        socketTimeout: Number(process.env.SMTP_TIMEOUT_MS || 10000),
        auth: {
            user: process.env.SMTP_USER,
            pass: String(process.env.SMTP_PASS || '').replace(/\s+/g, '')
        },
        tls: {
            servername: process.env.SMTP_SERVERNAME || process.env.SMTP_HOST
        }
    });

    return transporter;
};

const formatAppointmentDateTime = (appointment) => {
    const date = appointment.appointmentDate
        ? new Date(appointment.appointmentDate).toLocaleDateString('vi-VN')
        : '';
    const time = String(appointment.appointmentTime || '').slice(0, 5);
    return `${date}${time ? ` lúc ${time}` : ''}`;
};

const sendAppointmentReminderEmail = async (appointment) => {
    const mailer = getTransporter();
    if (!mailer || !appointment.patientEmail) {
        return { skipped: true, reason: 'email_not_configured' };
    }

    const clinicName = process.env.CLINIC_NAME || 'Phenikaa Dental';
    const appointmentTime = formatAppointmentDateTime(appointment);
    const subject = `Nhắc lịch hẹn nha khoa #${appointment.id}`;
    const text = [
        `Xin chào ${appointment.patientName || 'quý khách'},`,
        '',
        `${clinicName} nhắc bạn có lịch hẹn nha khoa #${appointment.id} vào ${appointmentTime}.`,
        appointment.dentistName ? `Bác sĩ phụ trách: ${appointment.dentistName}.` : '',
        appointment.serviceNames ? `Dịch vụ: ${appointment.serviceNames}.` : '',
        '',
        'Vui lòng đến trước giờ hẹn vài phút để lễ tân hỗ trợ check-in.',
        '',
        `Trân trọng,`,
        clinicName
    ].filter(Boolean).join('\n');

    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#2D3748">
            <h2 style="color:#2F8F7E">Nhắc lịch hẹn nha khoa</h2>
            <p>Xin chào <strong>${appointment.patientName || 'quý khách'}</strong>,</p>
            <p>${clinicName} nhắc bạn có lịch hẹn nha khoa <strong>#${appointment.id}</strong> vào <strong>${appointmentTime}</strong>.</p>
            ${appointment.dentistName ? `<p><strong>Bác sĩ phụ trách:</strong> ${appointment.dentistName}</p>` : ''}
            ${appointment.serviceNames ? `<p><strong>Dịch vụ:</strong> ${appointment.serviceNames}</p>` : ''}
            <p>Vui lòng đến trước giờ hẹn vài phút để lễ tân hỗ trợ check-in.</p>
            <p style="margin-top:24px">Trân trọng,<br/><strong>${clinicName}</strong></p>
        </div>
    `;

    await mailer.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: appointment.patientEmail,
        subject,
        text,
        html
    });

    return { skipped: false };
};

const sendFollowUpReminderEmail = async (record) => {
    const mailer = getTransporter();
    if (!mailer || !record.patientEmail) {
        return { skipped: true, reason: 'email_not_configured' };
    }

    const clinicName = process.env.CLINIC_NAME || 'Phenikaa Dental';
    const followUpDate = record.nextAppointmentDate
        ? new Date(record.nextAppointmentDate).toLocaleDateString('vi-VN')
        : '';
    const subject = `Nhắc lịch tái khám nha khoa #${record.id}`;
    const text = [
        `Xin chào ${record.patientName || 'quý khách'},`,
        '',
        `${clinicName} nhắc bạn có lịch tái khám vào ngày ${followUpDate}.`,
        record.dentistName ? `Bác sĩ phụ trách hồ sơ: ${record.dentistName}.` : '',
        record.nextAppointmentNote ? `Ghi chú tái khám: ${record.nextAppointmentNote}.` : '',
        record.diagnosis ? `Chẩn đoán lần khám trước: ${record.diagnosis}.` : '',
        '',
        'Vui lòng đăng nhập tài khoản để xem hồ sơ khám hoặc đặt lịch tái khám phù hợp.',
        '',
        'Trân trọng,',
        clinicName
    ].filter(Boolean).join('\n');

    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#2D3748">
            <h2 style="color:#2F8F7E">Nhắc lịch tái khám nha khoa</h2>
            <p>Xin chào <strong>${record.patientName || 'quý khách'}</strong>,</p>
            <p>${clinicName} nhắc bạn có lịch tái khám vào ngày <strong>${followUpDate}</strong>.</p>
            ${record.dentistName ? `<p><strong>Bác sĩ phụ trách hồ sơ:</strong> ${record.dentistName}</p>` : ''}
            ${record.nextAppointmentNote ? `<p><strong>Ghi chú tái khám:</strong> ${record.nextAppointmentNote}</p>` : ''}
            ${record.diagnosis ? `<p><strong>Chẩn đoán lần khám trước:</strong> ${record.diagnosis}</p>` : ''}
            <p>Vui lòng đăng nhập tài khoản để xem hồ sơ khám hoặc đặt lịch tái khám phù hợp.</p>
            <p style="margin-top:24px">Trân trọng,<br/><strong>${clinicName}</strong></p>
        </div>
    `;

    await mailer.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: record.patientEmail,
        subject,
        text,
        html
    });

    return { skipped: false };
};

const sendReleasedSlotOfferEmail = async ({ recipient, releasedSlot, currentAppointment }) => {
    const mailer = getTransporter();
    if (!mailer || !recipient?.email) {
        return { skipped: true, reason: 'email_not_configured' };
    }

    const clinicName = process.env.CLINIC_NAME || 'Phenikaa Dental';
    const releasedTime = formatAppointmentDateTime(releasedSlot);
    const currentTime = formatAppointmentDateTime(currentAppointment);
    const subject = `Có khung giờ khám sớm hơn tại ${clinicName}`;
    const text = [
        `Xin chào ${recipient.fullName || 'quý khách'},`,
        '',
        `${clinicName} vừa có một khung giờ trống: ${releasedTime}.`,
        releasedSlot.dentistName ? `Bác sĩ: ${releasedSlot.dentistName}.` : '',
        currentAppointment?.id ? `Bạn đang có lịch hẹn #${currentAppointment.id} vào ${currentTime}.` : '',
        '',
        'Nếu bạn muốn đổi lịch sang khung giờ này, vui lòng vào tài khoản để yêu cầu dời lịch hoặc liên hệ hotline phòng khám để lễ tân hỗ trợ.',
        '',
        'Trân trọng,',
        clinicName
    ].filter(Boolean).join('\n');

    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#2D3748">
            <h2 style="color:#2F8F7E">Có khung giờ khám sớm hơn</h2>
            <p>Xin chào <strong>${recipient.fullName || 'quý khách'}</strong>,</p>
            <p>${clinicName} vừa có một khung giờ trống: <strong>${releasedTime}</strong>.</p>
            ${releasedSlot.dentistName ? `<p><strong>Bác sĩ:</strong> ${releasedSlot.dentistName}</p>` : ''}
            ${currentAppointment?.id ? `<p>Bạn đang có lịch hẹn <strong>#${currentAppointment.id}</strong> vào <strong>${currentTime}</strong>.</p>` : ''}
            <p>Nếu bạn muốn đổi lịch sang khung giờ này, vui lòng vào tài khoản để yêu cầu dời lịch hoặc liên hệ hotline phòng khám để lễ tân hỗ trợ.</p>
            <p style="margin-top:24px">Trân trọng,<br/><strong>${clinicName}</strong></p>
        </div>
    `;

    await mailer.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: recipient.email,
        subject,
        text,
        html
    });

    return { skipped: false };
};

module.exports = {
    isEmailEnabled,
    sendAppointmentReminderEmail,
    sendFollowUpReminderEmail,
    sendReleasedSlotOfferEmail
};
