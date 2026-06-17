const pool = require('../config/database');

const categoryController = {
    // Lấy tất cả danh mục
    getAllCategories: async (req, res, next) => {
        try {
            const [categories] = await pool.query('SELECT * FROM Categories ORDER BY name ASC');
            res.json({
                success: true,
                message: 'Lấy danh mục thành công',
                data: categories
            });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ success: false, message: 'Tên danh mục đã tồn tại.' });
            }
            next(error);
        }
    },

    // Tạo danh mục mới
    createCategory: async (req, res, next) => {
        try {
            const { name, description } = req.body;
            if (!name) return res.status(400).json({ success: false, message: 'Tên danh mục là bắt buộc' });

            const [result] = await pool.query(
                'INSERT INTO Categories (name, description) VALUES (?, ?)',
                [name, description || null]
            );

            res.status(201).json({
                success: true,
                message: 'Tạo danh mục thành công',
                data: { id: result.insertId, name, description }
            });
        } catch (error) {
            next(error);
        }
    },

    // Sửa danh mục
    updateCategory: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { name, description } = req.body;

            if (!name) return res.status(400).json({ success: false, message: 'Tên danh mục là bắt buộc' });

            await pool.query(
                'UPDATE Categories SET name = ?, description = ? WHERE id = ?',
                [name, description || null, id]
            );

            res.json({ success: true, message: 'Cập nhật danh mục thành công' });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ success: false, message: 'Tên danh mục đã tồn tại.' });
            }
            next(error);
        }
    },

    // Xóa danh mục
    deleteCategory: async (req, res, next) => {
        try {
            const { id } = req.params;
            await pool.query('DELETE FROM Categories WHERE id = ?', [id]);
            res.json({ success: true, message: 'Xóa danh mục thành công' });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = categoryController;
