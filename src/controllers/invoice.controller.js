const pool = require('../config/database');
const { createNotification, createNotificationsForRoles } = require('../services/notification.service');

const validPaymentMethods = ['cash', 'card', 'transfer', 'vnpay', 'momo'];
const validInvoicePaymentMethods = ['cash', 'card', 'transfer'];
const invoiceReadableRoles = ['admin', 'staff', 'patient'];

const toInvoicePaymentMethod = (paymentMethod) => {
    if (paymentMethod === 'vnpay' || paymentMethod === 'momo') {
        return 'transfer';
    }

    return paymentMethod;
};

const invoiceController = {
    createInvoice: async (req, res, next) => {
        const connection = await pool.getConnection();

        try {
            const appointmentId = Number(req.body.appointmentId);
            const invoicePaymentMethod = req.body.paymentMethod || 'cash';

            if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
                return res.status(400).json({ success: false, message: 'ID lịch hẹn không hợp lệ.' });
            }

            if (!validInvoicePaymentMethods.includes(invoicePaymentMethod)) {
                return res.status(400).json({
                    success: false,
                    message: 'Phương thức thanh toán khi xuất hóa đơn chỉ hỗ trợ cash, card hoặc transfer.'
                });
            }

            await connection.beginTransaction();

            const [appointments] = await connection.query(
                'SELECT id, patientId, status FROM Appointments WHERE id = ? FOR UPDATE',
                [appointmentId]
            );
            if (appointments.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy lịch hẹn.' });
            }

            const appointment = appointments[0];
            if (appointment.status !== 'completed') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Chỉ có thể xuất hóa đơn cho lịch hẹn đã hoàn thành.'
                });
            }

            const [existingInvoices] = await connection.query(
                'SELECT id FROM Invoices WHERE appointmentId = ? LIMIT 1',
                [appointmentId]
            );
            if (existingInvoices.length > 0) {
                await connection.rollback();
                return res.status(409).json({ success: false, message: 'Lịch hẹn này đã có hóa đơn.' });
            }

            const [services] = await connection.query(`
                SELECT s.price
                FROM Appointment_Services asrv
                JOIN Services s ON asrv.serviceId = s.id
                WHERE asrv.appointmentId = ?
            `, [appointmentId]);

            if (services.length === 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Lịch hẹn chưa có dịch vụ để xuất hóa đơn.'
                });
            }

            const totalAmount = services.reduce((sum, service) => sum + Number(service.price || 0), 0);
            if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Tổng tiền hóa đơn không hợp lệ.' });
            }

            const [result] = await connection.query(
                'INSERT INTO Invoices (appointmentId, patientId, totalAmount, paymentMethod, status) VALUES (?, ?, ?, ?, ?)',
                [appointmentId, appointment.patientId, totalAmount, invoicePaymentMethod, 'unpaid']
            );

            await connection.commit();

            await createNotification(
                pool,
                appointment.patientId,
                'Hóa đơn mới',
                `Hóa đơn #${result.insertId} đã được tạo cho lịch hẹn #${appointmentId}.`,
                'payment'
            );

            res.status(201).json({
                success: true,
                message: 'Tạo hóa đơn thành công.',
                data: {
                    id: result.insertId,
                    appointmentId,
                    patientId: appointment.patientId,
                    totalAmount,
                    paymentMethod: invoicePaymentMethod,
                    status: 'unpaid'
                }
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    getAllInvoices: async (req, res, next) => {
        try {
            const role = req.user.role;
            const userId = req.user.id;

            if (!invoiceReadableRoles.includes(role)) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền xem danh sách hóa đơn.' });
            }

            let query = `
                SELECT i.*, p.fullName as patientName, p.phone as patientPhone, a.appointmentDate,
                       pay.paymentMethod as lastPaymentMethod,
                       pay.transactionId as lastTransactionId,
                       pay.createdAt as paidAt
                FROM Invoices i
                JOIN Users p ON i.patientId = p.id
                JOIN Appointments a ON i.appointmentId = a.id
                LEFT JOIN (
                    SELECT p1.*
                    FROM Payments p1
                    INNER JOIN (
                        SELECT invoiceId, MAX(id) as latestPaymentId
                        FROM Payments
                        WHERE status = "success"
                        GROUP BY invoiceId
                    ) latest ON p1.id = latest.latestPaymentId
                ) pay ON pay.invoiceId = i.id
                WHERE 1=1
            `;
            const queryParams = [];

            if (role === 'patient') {
                query += ' AND i.patientId = ?';
                queryParams.push(userId);
            }

            query += ' ORDER BY i.createdAt DESC';

            const [invoices] = await pool.query(query, queryParams);

            res.json({
                success: true,
                message: 'Lấy danh sách hóa đơn thành công.',
                data: invoices
            });
        } catch (error) {
            next(error);
        }
    },

    payInvoice: async (req, res, next) => {
        const connection = await pool.getConnection();

        try {
            const invoiceId = Number(req.params.id);
            const { paymentMethod = 'cash', transactionId = null } = req.body;

            if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
                return res.status(400).json({ success: false, message: 'ID hóa đơn không hợp lệ.' });
            }

            if (!validPaymentMethods.includes(paymentMethod)) {
                return res.status(400).json({ success: false, message: 'Phương thức thanh toán không hợp lệ.' });
            }

            await connection.beginTransaction();

            const [invoices] = await connection.query(
                'SELECT id, patientId, status, totalAmount FROM Invoices WHERE id = ? FOR UPDATE',
                [invoiceId]
            );
            if (invoices.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
            }

            const invoice = invoices[0];
            if (invoice.status === 'paid') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Hóa đơn này đã được thanh toán.' });
            }

            if (invoice.status === 'cancelled') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Không thể thanh toán hóa đơn đã bị hủy.' });
            }

            if (!Number.isFinite(Number(invoice.totalAmount)) || Number(invoice.totalAmount) <= 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Tổng tiền hóa đơn không hợp lệ.' });
            }

            await connection.query(
                'UPDATE Invoices SET status = "paid", paymentMethod = ? WHERE id = ?',
                [toInvoicePaymentMethod(paymentMethod), invoiceId]
            );

            const [paymentResult] = await connection.query(
                'INSERT INTO Payments (invoiceId, amount, paymentMethod, transactionId, status) VALUES (?, ?, ?, ?, "success")',
                [invoiceId, invoice.totalAmount, paymentMethod, transactionId]
            );

            await connection.commit();

            await createNotification(
                pool,
                invoice.patientId,
                'Thanh toán thành công',
                `Hóa đơn #${invoiceId} đã được thanh toán thành công.`,
                'payment'
            );
            await createNotificationsForRoles(
                pool,
                ['admin', 'staff'],
                'Hóa đơn đã thanh toán',
                `Hóa đơn #${invoiceId} đã được thanh toán.`,
                'payment'
            );

            res.json({
                success: true,
                message: 'Thanh toán hóa đơn thành công.',
                data: {
                    paymentId: paymentResult.insertId,
                    invoiceId,
                    amount: Number(invoice.totalAmount),
                    paymentMethod
                }
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    }
};

module.exports = invoiceController;
