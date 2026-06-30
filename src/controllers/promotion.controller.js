const pool = require('../config/database');

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

const toDateOnly = (value) => {
    if (!value) return null;
    if (value instanceof Date) return vietnamDateFormatter.format(value);
    return String(value).slice(0, 10);
};

const getTodayDateOnly = () => {
    return vietnamDateFormatter.format(new Date());
};

const withPromotionStatus = (promotion, today = getTodayDateOnly()) => {
    const startDate = toDateOnly(promotion.startDate);
    const endDate = toDateOnly(promotion.endDate);
    const isManuallyActive = Number(promotion.isActive) === 1;

    let effectiveStatus = 'active';
    if (!isManuallyActive) {
        effectiveStatus = 'inactive';
    } else if (startDate && startDate > today) {
        effectiveStatus = 'upcoming';
    } else if (endDate && endDate < today) {
        effectiveStatus = 'expired';
    }

    const labels = {
        active: 'Hoạt động',
        upcoming: 'Sắp diễn ra',
        expired: 'Hết hạn',
        inactive: 'Đã tắt'
    };

    return {
        ...promotion,
        startDate,
        endDate,
        effectiveStatus,
        effectiveLabel: labels[effectiveStatus],
        canUseNow: effectiveStatus === 'active'
    };
};

const validatePromotionPayload = ({ name, discountPercent, startDate, endDate }) => {
    const discount = Number(discountPercent);

    if (!name || discountPercent === undefined || discountPercent === '') {
        return 'Tên và phần trăm giảm giá là bắt buộc.';
    }

    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
        return 'Phần trăm giảm giá phải nằm trong khoảng 0-100.';
    }

    if (startDate && endDate && startDate > endDate) {
        return 'Ngày kết thúc không được trước ngày bắt đầu.';
    }

    return null;
};

const promotionController = {
    // Lấy danh sách khuyến mãi
    getAllPromotions: async (req, res, next) => {
        try {
            const today = getTodayDateOnly();
            const [promotions] = await pool.query('SELECT * FROM Promotions ORDER BY createdAt DESC');
            res.json({
                success: true,
                message: 'Lấy khuyến mãi thành công',
                data: promotions.map((promotion) => withPromotionStatus(promotion, today))
            });
        } catch (error) {
            next(error);
        }
    },

    // Lấy khuyến mãi đang hoạt động (cho khách hàng)
    getActivePromotions: async (req, res, next) => {
        try {
            const today = getTodayDateOnly();
            const query = `
                SELECT * FROM Promotions 
                WHERE isActive = 1 
                AND (startDate IS NULL OR startDate <= ?)
                AND (endDate IS NULL OR endDate >= ?)
                ORDER BY createdAt DESC
            `;
            const [promotions] = await pool.query(query, [today, today]);
            res.json({
                success: true,
                message: 'Lấy khuyến mãi đang hoạt động thành công',
                data: promotions.map((promotion) => withPromotionStatus(promotion, today))
            });
        } catch (error) {
            next(error);
        }
    },

    // Tạo mới khuyến mãi
    createPromotion: async (req, res, next) => {
        try {
            const { name, description, discountPercent, startDate, endDate, isActive } = req.body;
            const validationError = validatePromotionPayload({ name, discountPercent, startDate, endDate });
            if (validationError) {
                return res.status(400).json({ success: false, message: validationError });
            }

            const [result] = await pool.query(
                'INSERT INTO Promotions (name, description, discountPercent, startDate, endDate, isActive) VALUES (?, ?, ?, ?, ?, ?)',
                [name.trim(), description || null, Number(discountPercent), startDate || null, endDate || null, isActive !== undefined ? isActive : 1]
            );

            res.status(201).json({
                success: true,
                message: 'Tạo khuyến mãi thành công',
                data: { id: result.insertId, name, discountPercent }
            });
        } catch (error) {
            next(error);
        }
    },

    // Cập nhật khuyến mãi
    updatePromotion: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { name, description, discountPercent, startDate, endDate, isActive } = req.body;
            const validationError = validatePromotionPayload({ name, discountPercent, startDate, endDate });
            if (validationError) {
                return res.status(400).json({ success: false, message: validationError });
            }

            const [result] = await pool.query(
                'UPDATE Promotions SET name = ?, description = ?, discountPercent = ?, startDate = ?, endDate = ?, isActive = ? WHERE id = ?',
                [name.trim(), description || null, Number(discountPercent), startDate || null, endDate || null, isActive !== undefined ? isActive : 1, id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy khuyến mãi.' });
            }

            res.json({ success: true, message: 'Cập nhật khuyến mãi thành công' });
        } catch (error) {
            next(error);
        }
    },

    // Xóa (vô hiệu hóa) khuyến mãi
    deletePromotion: async (req, res, next) => {
        try {
            const { id } = req.params;
            await pool.query('UPDATE Promotions SET isActive = 0 WHERE id = ?', [id]);
            res.json({ success: true, message: 'Vô hiệu hóa khuyến mãi thành công' });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = promotionController;
