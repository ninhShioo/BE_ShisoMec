const pool = require('../config/database');
const { withServiceDisplayImage } = require('../utils/mediaDefaults');

const validServiceStatuses = ['active', 'inactive'];

const parsePositivePrice = (price) => {
    const parsedPrice = Number(price);
    return Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;
};

const parseOptionalDuration = (duration) => {
    if (duration === undefined || duration === null || duration === '') {
        return null;
    }

    const parsedDuration = Number(duration);
    return Number.isInteger(parsedDuration) && parsedDuration >= 0 ? parsedDuration : null;
};

const serviceController = {
    // 1. Lấy danh sách tất cả dịch vụ (Public - Ai cũng xem được)
    getAllServices: async (req, res, next) => {
        try {
            // Có thể thêm phân trang (pagination) ở đây sau nếu cần
            const [services] = await pool.query(`
                SELECT s.*, c.name AS categoryName
                FROM Services s
                LEFT JOIN Categories c ON s.categoryId = c.id
                WHERE s.status = "active"
                ORDER BY s.createdAt DESC
            `);
            res.json({
                success: true,
                message: 'Lấy danh sách dịch vụ thành công.',
                data: services.map(withServiceDisplayImage)
            });
        } catch (error) {
            next(error);
        }
    },

    // 2. Lấy thông tin chi tiết 1 dịch vụ (Public)
    getManageServices: async (req, res, next) => {
        try {
            const [services] = await pool.query(`
                SELECT s.*, c.name AS categoryName
                FROM Services s
                LEFT JOIN Categories c ON s.categoryId = c.id
                ORDER BY s.createdAt DESC
            `);
            res.json({
                success: true,
                message: 'Lấy danh sách quản lý dịch vụ thành công.',
                data: services.map(withServiceDisplayImage)
            });
        } catch (error) {
            next(error);
        }
    },

    getServiceById: async (req, res, next) => {
        try {
            const { id } = req.params;
            const [services] = await pool.query('SELECT * FROM Services WHERE id = ? AND status = "active"', [id]);

            if (services.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy dịch vụ.' });
            }

            res.json({
                success: true,
                message: 'Lấy thông tin dịch vụ thành công.',
                data: withServiceDisplayImage(services[0])
            });
        } catch (error) {
            next(error);
        }
    },

    // 3. Thêm mới dịch vụ (Chỉ Admin)
    createService: async (req, res, next) => {
        try {
            const { name, description, price, duration, status, image, categoryId } = req.body;
            const parsedPrice = parsePositivePrice(price);
            const parsedDuration = parseOptionalDuration(duration);
            const serviceStatus = status || 'active';

            if (!name || !name.trim() || !parsedPrice) {
                return res.status(400).json({ success: false, message: 'Tên dịch vụ và Giá là bắt buộc.' });
            }

            if (duration !== undefined && duration !== null && duration !== '' && parsedDuration === null) {
                return res.status(400).json({ success: false, message: 'Thời gian phải là số nguyên không âm.' });
            }

            if (!validServiceStatuses.includes(serviceStatus)) {
                return res.status(400).json({ success: false, message: 'Trạng thái dịch vụ không hợp lệ.' });
            }

            const [result] = await pool.query(
                'INSERT INTO Services (name, description, price, duration, status, image, categoryId) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [name.trim(), description, parsedPrice, parsedDuration, serviceStatus, image || null, categoryId || null]
            );

            res.status(201).json({
                success: true,
                message: 'Thêm dịch vụ mới thành công.',
                data: { id: result.insertId, name: name.trim(), price: parsedPrice, duration: parsedDuration, status: serviceStatus, image, categoryId }
            });
        } catch (error) {
            next(error);
        }
    },

    // 4. Cập nhật dịch vụ (Chỉ Admin)
    updateService: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { name, description, price, duration, status, image, categoryId } = req.body;
            const parsedPrice = parsePositivePrice(price);
            const parsedDuration = parseOptionalDuration(duration);
            const serviceStatus = status || 'active';

            // Kiểm tra dịch vụ tồn tại không
            if (!name || !name.trim() || !parsedPrice) {
                return res.status(400).json({ success: false, message: 'Tên dịch vụ và giá là bắt buộc.' });
            }

            if (duration !== undefined && duration !== null && duration !== '' && parsedDuration === null) {
                return res.status(400).json({ success: false, message: 'Thời gian phải là số nguyên không âm.' });
            }

            if (!validServiceStatuses.includes(serviceStatus)) {
                return res.status(400).json({ success: false, message: 'Trạng thái dịch vụ không hợp lệ.' });
            }

            const [existing] = await pool.query('SELECT id FROM Services WHERE id = ?', [id]);
            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy dịch vụ để cập nhật.' });
            }

            await pool.query(
                'UPDATE Services SET name = ?, description = ?, price = ?, duration = ?, status = ?, image = ?, categoryId = ? WHERE id = ?',
                [name.trim(), description, parsedPrice, parsedDuration, serviceStatus, image || null, categoryId || null, id]
            );

            res.json({
                success: true,
                message: 'Cập nhật dịch vụ thành công.'
            });
        } catch (error) {
            next(error);
        }
    },

    // 5. Xóa (hoặc ẩn) dịch vụ (Chỉ Admin)
    // Thường trong y tế/kế toán, ta không DELETE cứng, mà chuyển status = 'inactive'
    deleteService: async (req, res, next) => {
        try {
            const { id } = req.params;
            
            const [existing] = await pool.query('SELECT id FROM Services WHERE id = ?', [id]);
            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy dịch vụ để xóa.' });
            }

            // Chuyển status thành inactive (Soft delete)
            await pool.query('UPDATE Services SET status = "inactive" WHERE id = ?', [id]);

            res.json({
                success: true,
                message: 'Đã vô hiệu hóa (xóa) dịch vụ thành công.'
            });
        } catch (error) {
            next(error);
        }
    },

    // 6. Thống kê số lượt sử dụng từng dịch vụ (Dùng cho Pie Chart)
    getServiceUsage: async (req, res, next) => {
        try {
            const query = `
                SELECT s.name, COUNT(asv.serviceId) as value
                FROM Services s
                LEFT JOIN Appointment_Services asv ON s.id = asv.serviceId
                GROUP BY s.id, s.name
                ORDER BY value DESC
            `;
            const [stats] = await pool.query(query);
            
            res.json({
                success: true,
                message: 'Lấy thống kê dịch vụ thành công.',
                data: stats
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = serviceController;
