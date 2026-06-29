const pool = require('../config/database');

const defaultSettings = {
    clinicName: 'Phenikaa Dental',
    phone: '0869 800 318',
    email: 'contact@phenikaadental.vn',
    address: 'Tòa nhà Phenikaa Tower, Hà Nội',
    openingHours: '08:00 - 20:00',
    bookingLeadHours: 24,
    appointmentReminderHours: 4,
    maintenanceMode: false,
    allowOnlineBooking: true,
    theme: 'light'
};

const allowedKeys = Object.keys(defaultSettings);
const numericKeys = ['bookingLeadHours', 'appointmentReminderHours'];
const booleanKeys = ['maintenanceMode', 'allowOnlineBooking'];
const stringKeys = allowedKeys.filter((key) => !numericKeys.includes(key) && !booleanKeys.includes(key));

const parseSettingValue = (key, value) => {
    if (booleanKeys.includes(key)) {
        return value === true || value === 1 || value === '1' || value === 'true';
    }

    if (numericKeys.includes(key)) {
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue : defaultSettings[key];
    }

    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
};

const serializeSettingValue = (key, value) => {
    if (booleanKeys.includes(key)) return value ? 'true' : 'false';
    return String(value ?? '').trim();
};

const normalizeSettings = (rows) => {
    const settings = { ...defaultSettings };

    rows.forEach((row) => {
        if (allowedKeys.includes(row.settingKey)) {
            settings[row.settingKey] = parseSettingValue(row.settingKey, row.settingValue);
        }
    });

    return settings;
};

const loadSettings = async (connection = pool) => {
    const [rows] = await connection.query(
        'SELECT settingKey, settingValue FROM Settings WHERE settingKey IN (?)',
        [allowedKeys]
    );

    return normalizeSettings(rows);
};

const normalizeIncomingSettings = (baseSettings, incomingSettings = {}) => {
    const nextSettings = { ...baseSettings };

    allowedKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(incomingSettings, key)) {
            nextSettings[key] = parseSettingValue(key, incomingSettings[key]);
        }
    });

    stringKeys.forEach((key) => {
        nextSettings[key] = String(nextSettings[key] ?? '').trim();
    });

    numericKeys.forEach((key) => {
        nextSettings[key] = Number(nextSettings[key]);
    });

    return nextSettings;
};

const validateSettings = (settings) => {
    if (!settings.clinicName) return 'Tên phòng khám là bắt buộc.';
    if (!settings.phone) return 'Hotline là bắt buộc.';
    if (settings.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) return 'Email liên hệ không hợp lệ.';
    if (!settings.address) return 'Địa chỉ là bắt buộc.';
    if (!settings.openingHours) return 'Giờ làm việc là bắt buộc.';

    if (!Number.isInteger(settings.bookingLeadHours) || settings.bookingLeadHours < 0 || settings.bookingLeadHours > 168) {
        return 'Thời gian đặt trước phải từ 0 đến 168 giờ.';
    }

    if (!Number.isInteger(settings.appointmentReminderHours) || settings.appointmentReminderHours < 1 || settings.appointmentReminderHours > 24) {
        return 'Nhắc xác nhận lịch phải từ 1 đến 24 giờ.';
    }

    if (!['light', 'dark'].includes(settings.theme)) return 'Giao diện không hợp lệ.';
    return null;
};

const settingsController = {
    getPublicSettings: async (req, res, next) => {
        try {
            const settings = await loadSettings();
            res.json({
                success: true,
                message: 'Lấy thông tin phòng khám thành công.',
                data: {
                    clinicName: settings.clinicName,
                    phone: settings.phone,
                    email: settings.email,
                    address: settings.address,
                    openingHours: settings.openingHours,
                    allowOnlineBooking: settings.allowOnlineBooking
                }
            });
        } catch (error) {
            next(error);
        }
    },

    getSettings: async (req, res, next) => {
        try {
            res.json({
                success: true,
                message: 'Lấy cấu hình hệ thống thành công.',
                data: await loadSettings()
            });
        } catch (error) {
            next(error);
        }
    },

    updateSettings: async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            const currentSettings = await loadSettings(connection);
            const nextSettings = normalizeIncomingSettings(currentSettings, req.body || {});

            const validationMessage = validateSettings(nextSettings);
            if (validationMessage) {
                return res.status(400).json({ success: false, message: validationMessage });
            }

            await connection.beginTransaction();

            for (const key of allowedKeys) {
                await connection.query(
                    `INSERT INTO Settings (settingKey, settingValue)
                     VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue)`,
                    [key, serializeSettingValue(key, nextSettings[key])]
                );
            }

            await connection.commit();

            res.json({
                success: true,
                message: 'Lưu cấu hình hệ thống thành công.',
                data: nextSettings
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    }
};

module.exports = settingsController;
