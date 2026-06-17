const pool = require('../config/database');

const promotionController = {
    // Lấy danh sách khuyến mãi
    getAllPromotions: async (req, res, next) => {
        try {
            const [promotions] = await pool.query('SELECT * FROM Promotions ORDER BY createdAt DESC');
            res.json({
                success: true,
                message: 'Lấy khuyến mãi thành công',
                data: promotions
            });
        } catch (error) {
            next(error);
        }
    },

    // Lấy khuyến mãi đang hoạt động (cho khách hàng)
    getActivePromotions: async (req, res, next) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            const query = `
                SELECT * FROM Promotions 
                WHERE isActive = 1 
                AND startDate <= ? 
                AND (endDate IS NULL OR endDate >= ?)
            `;
            const [promotions] = await pool.query(query, [today, today]);
            res.json({
                success: true,
                message: 'Lấy khuyến mãi đang hoạt động thành công',
                data: promotions
            });
        } catch (error) {
            next(error);
        }
    },

    // Tạo mới khuyến mãi
    createPromotion: async (req, res, next) => {
        try {
            const { name, description, discountPercent, startDate, endDate, isActive } = req.body;
            if (!name || discountPercent === undefined) {
                return res.status(400).json({ success: false, message: 'Tên và phần trăm giảm giá là bắt buộc.' });
            }

            const [result] = await pool.query(
                'INSERT INTO Promotions (name, description, discountPercent, startDate, endDate, isActive) VALUES (?, ?, ?, ?, ?, ?)',
                [name, description || null, discountPercent, startDate || null, endDate || null, isActive !== undefined ? isActive : 1]
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

            await pool.query(
                'UPDATE Promotions SET name = ?, description = ?, discountPercent = ?, startDate = ?, endDate = ?, isActive = ? WHERE id = ?',
                [name, description || null, discountPercent, startDate || null, endDate || null, isActive !== undefined ? isActive : 1, id]
            );

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
