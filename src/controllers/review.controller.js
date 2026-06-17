const pool = require('../config/database');
const { createNotification, createNotificationsForRoles } = require('../services/notification.service');

const normalizeRating = (rating) => {
    const value = Number(rating);
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
};

const reviewController = {
    getApprovedReviews: async (req, res, next) => {
        try {
            const [reviews] = await pool.query(`
                SELECT r.id, r.rating, r.comment, r.createdAt,
                       u.fullName as patientName,
                       s.name as serviceName
                FROM Reviews r
                JOIN Users u ON r.patientId = u.id
                JOIN Appointments a ON r.appointmentId = a.id
                LEFT JOIN Appointment_Services aps ON aps.appointmentId = a.id
                LEFT JOIN Services s ON s.id = aps.serviceId
                WHERE r.status = "approved"
                GROUP BY r.id, r.rating, r.comment, r.createdAt, u.fullName, s.name
                ORDER BY r.createdAt DESC
                LIMIT 12
            `);

            res.json({ success: true, message: 'Lấy đánh giá thành công.', data: reviews });
        } catch (error) {
            next(error);
        }
    },

    getMyReviews: async (req, res, next) => {
        try {
            const [reviews] = await pool.query(
                `SELECT id, appointmentId, rating, comment, status, createdAt
                 FROM Reviews
                 WHERE patientId = ?
                 ORDER BY createdAt DESC`,
                [req.user.id]
            );

            res.json({ success: true, message: 'Lấy đánh giá của tôi thành công.', data: reviews });
        } catch (error) {
            next(error);
        }
    },

    getAllReviews: async (req, res, next) => {
        try {
            const [reviews] = await pool.query(`
                SELECT r.*, u.fullName as patientName, a.appointmentDate
                FROM Reviews r
                JOIN Users u ON r.patientId = u.id
                JOIN Appointments a ON r.appointmentId = a.id
                ORDER BY r.createdAt DESC
            `);

            res.json({ success: true, message: 'Lấy danh sách đánh giá thành công.', data: reviews });
        } catch (error) {
            next(error);
        }
    },

    createReview: async (req, res, next) => {
        try {
            const appointmentId = Number(req.body.appointmentId);
            const rating = normalizeRating(req.body.rating);
            const comment = String(req.body.comment || '').trim();

            if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
                return res.status(400).json({ success: false, message: 'ID lịch hẹn không hợp lệ.' });
            }

            if (!rating) {
                return res.status(400).json({ success: false, message: 'Đánh giá phải từ 1 đến 5 sao.' });
            }

            if (!comment) {
                return res.status(400).json({ success: false, message: 'Nội dung đánh giá là bắt buộc.' });
            }

            const [appointments] = await pool.query(
                'SELECT id FROM Appointments WHERE id = ? AND patientId = ? AND status = "completed"',
                [appointmentId, req.user.id]
            );
            if (appointments.length === 0) {
                return res.status(403).json({ success: false, message: 'Chỉ có thể đánh giá lịch hẹn đã hoàn thành của bạn.' });
            }

            const [existing] = await pool.query('SELECT id FROM Reviews WHERE appointmentId = ? LIMIT 1', [appointmentId]);
            if (existing.length > 0) {
                return res.status(409).json({ success: false, message: 'Lịch hẹn này đã có đánh giá.' });
            }

            const [result] = await pool.query(
                'INSERT INTO Reviews (patientId, appointmentId, rating, comment, status) VALUES (?, ?, ?, ?, "pending")',
                [req.user.id, appointmentId, rating, comment]
            );

            await createNotificationsForRoles(
                pool,
                ['admin'],
                'Đánh giá mới chờ duyệt',
                `${req.user.fullName} vừa gửi đánh giá cho lịch hẹn #${appointmentId}.`,
                'system'
            );

            res.status(201).json({
                success: true,
                message: 'Đã gửi đánh giá. Đánh giá sẽ hiển thị sau khi được duyệt.',
                data: { id: result.insertId }
            });
        } catch (error) {
            next(error);
        }
    },

    updateReviewStatus: async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            const { status } = req.body;

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'ID đánh giá không hợp lệ.' });
            }

            if (!['pending', 'approved', 'hidden'].includes(status)) {
                return res.status(400).json({ success: false, message: 'Trạng thái đánh giá không hợp lệ.' });
            }

            const [reviews] = await pool.query('SELECT patientId FROM Reviews WHERE id = ? LIMIT 1', [id]);
            if (reviews.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy đánh giá.' });
            }

            const [result] = await pool.query('UPDATE Reviews SET status = ? WHERE id = ?', [status, id]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy đánh giá.' });
            }

            if (status === 'approved') {
                await createNotification(
                    pool,
                    reviews[0].patientId,
                    'Đánh giá đã được duyệt',
                    'Đánh giá của bạn đã được duyệt và hiển thị công khai.',
                    'system'
                );
            }

            res.json({ success: true, message: 'Đã cập nhật trạng thái đánh giá.' });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = reviewController;
