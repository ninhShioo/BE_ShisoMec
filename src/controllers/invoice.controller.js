const pool = require('../config/database');
const { createNotification, createNotificationsForRoles } = require('../services/notification.service');

const validPaymentMethods = ['cash', 'card', 'transfer', 'vnpay', 'momo'];
const validInvoicePaymentMethods = ['cash', 'card', 'transfer'];
const invoiceReadableRoles = ['admin', 'staff', 'patient'];

const toInvoicePaymentMethod = (paymentMethod) => {
    if (paymentMethod === 'vnpay' || paymentMethod === 'momo') return 'transfer';
    return paymentMethod;
};

const money = (value) => {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
};

const getInvoiceItems = async (connectionOrPool, invoiceIds) => {
    const ids = [...new Set((Array.isArray(invoiceIds) ? invoiceIds : [invoiceIds]).map(Number).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const [items] = await connectionOrPool.query(
        `SELECT id, invoiceId, serviceId, description, quantity, unitPrice, totalPrice
         FROM InvoiceItems
         WHERE invoiceId IN (?)
         ORDER BY id`,
        [ids]
    );

    return items.reduce((map, item) => {
        const current = map.get(item.invoiceId) || [];
        current.push({
            ...item,
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            totalPrice: Number(item.totalPrice || 0)
        });
        map.set(item.invoiceId, current);
        return map;
    }, new Map());
};

const getInvoicePayments = async (connectionOrPool, invoiceIds) => {
    const ids = [...new Set((Array.isArray(invoiceIds) ? invoiceIds : [invoiceIds]).map(Number).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const [payments] = await connectionOrPool.query(
        `SELECT id, invoiceId, amount, paymentMethod, transactionId, status, createdAt
         FROM Payments
         WHERE invoiceId IN (?)
         ORDER BY createdAt DESC, id DESC`,
        [ids]
    );

    return payments.reduce((map, payment) => {
        const current = map.get(payment.invoiceId) || [];
        current.push({
            ...payment,
            amount: Number(payment.amount || 0)
        });
        map.set(payment.invoiceId, current);
        return map;
    }, new Map());
};

const mapInvoice = (invoice, itemsByInvoice, paymentsByInvoice) => {
    const subtotalAmount = money(invoice.subtotalAmount || invoice.totalAmount);
    const discountAmount = money(invoice.discountAmount);
    const paidAmount = money(invoice.paidAmount);
    const totalAmount = money(invoice.totalAmount);

    return {
        ...invoice,
        subtotalAmount,
        discountAmount,
        paidAmount,
        totalAmount,
        outstandingAmount: Math.max(totalAmount - paidAmount, 0),
        items: itemsByInvoice.get(invoice.id) || [],
        payments: paymentsByInvoice.get(invoice.id) || []
    };
};

const invoiceController = {
    createInvoice: async (req, res, next) => {
        const connection = await pool.getConnection();

        try {
            const appointmentId = Number(req.body.appointmentId);
            const invoicePaymentMethod = req.body.paymentMethod || 'cash';
            const discountAmount = money(req.body.discountAmount);
            const note = req.body.note ? String(req.body.note).trim() : null;

            if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
                return res.status(400).json({ success: false, message: 'ID lịch hẹn không hợp lệ.' });
            }

            if (!validInvoicePaymentMethods.includes(invoicePaymentMethod)) {
                return res.status(400).json({
                    success: false,
                    message: 'Phương thức khi xuất hóa đơn chỉ hỗ trợ cash, card hoặc transfer.'
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
                SELECT s.id, s.name, s.price
                FROM Appointment_Services asrv
                JOIN Services s ON asrv.serviceId = s.id
                WHERE asrv.appointmentId = ?
                ORDER BY s.name
            `, [appointmentId]);

            if (services.length === 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Lịch hẹn chưa có dịch vụ để xuất hóa đơn.'
                });
            }

            const subtotalAmount = services.reduce((sum, service) => sum + money(service.price), 0);
            const safeDiscount = Math.min(discountAmount, subtotalAmount);
            const totalAmount = subtotalAmount - safeDiscount;

            if (totalAmount <= 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Tổng tiền hóa đơn không hợp lệ.' });
            }

            const [result] = await connection.query(
                `INSERT INTO Invoices
                 (appointmentId, patientId, subtotalAmount, discountAmount, paidAmount, totalAmount, paymentMethod, status, note)
                 VALUES (?, ?, ?, ?, 0, ?, ?, "unpaid", ?)`,
                [appointmentId, appointment.patientId, subtotalAmount, safeDiscount, totalAmount, invoicePaymentMethod, note]
            );
            const invoiceId = result.insertId;

            for (const service of services) {
                const unitPrice = money(service.price);
                await connection.query(
                    `INSERT INTO InvoiceItems
                     (invoiceId, serviceId, description, quantity, unitPrice, totalPrice)
                     VALUES (?, ?, ?, 1, ?, ?)`,
                    [invoiceId, service.id, service.name, unitPrice, unitPrice]
                );
            }

            await connection.commit();

            await createNotification(
                pool,
                appointment.patientId,
                'Hóa đơn mới',
                `Hóa đơn #${invoiceId} đã được tạo cho lịch hẹn #${appointmentId}.`,
                'payment'
            );

            res.status(201).json({
                success: true,
                message: 'Tạo hóa đơn thành công.',
                data: {
                    id: invoiceId,
                    appointmentId,
                    patientId: appointment.patientId,
                    subtotalAmount,
                    discountAmount: safeDiscount,
                    paidAmount: 0,
                    totalAmount,
                    outstandingAmount: totalAmount,
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
            const itemsByInvoice = await getInvoiceItems(pool, invoices.map((invoice) => invoice.id));
            const paymentsByInvoice = await getInvoicePayments(pool, invoices.map((invoice) => invoice.id));
            const data = invoices.map((invoice) => mapInvoice(invoice, itemsByInvoice, paymentsByInvoice));

            res.json({
                success: true,
                message: 'Lấy danh sách hóa đơn thành công.',
                data
            });
        } catch (error) {
            next(error);
        }
    },

    getInvoiceById: async (req, res, next) => {
        try {
            const invoiceId = Number(req.params.id);
            if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
                return res.status(400).json({ success: false, message: 'ID hóa đơn không hợp lệ.' });
            }

            let query = `
                SELECT i.*, p.fullName as patientName, p.phone as patientPhone, p.email as patientEmail,
                       a.appointmentDate, a.appointmentTime,
                       d.fullName as dentistName,
                       pay.paymentMethod as lastPaymentMethod,
                       pay.transactionId as lastTransactionId,
                       pay.createdAt as paidAt
                FROM Invoices i
                JOIN Users p ON i.patientId = p.id
                JOIN Appointments a ON i.appointmentId = a.id
                LEFT JOIN Users d ON a.dentistId = d.id
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
                WHERE i.id = ?
            `;
            const params = [invoiceId];

            if (req.user.role === 'patient') {
                query += ' AND i.patientId = ?';
                params.push(req.user.id);
            }

            const [invoices] = await pool.query(query, params);
            if (invoices.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
            }

            const itemsByInvoice = await getInvoiceItems(pool, invoiceId);
            const paymentsByInvoice = await getInvoicePayments(pool, invoiceId);

            res.json({
                success: true,
                message: 'Lấy chi tiết hóa đơn thành công.',
                data: mapInvoice(invoices[0], itemsByInvoice, paymentsByInvoice)
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
            const requestedAmount = req.body.amount === undefined ? null : money(req.body.amount);

            if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
                return res.status(400).json({ success: false, message: 'ID hóa đơn không hợp lệ.' });
            }

            if (!validPaymentMethods.includes(paymentMethod)) {
                return res.status(400).json({ success: false, message: 'Phương thức thanh toán không hợp lệ.' });
            }

            await connection.beginTransaction();

            const [invoices] = await connection.query(
                'SELECT id, patientId, status, totalAmount, paidAmount FROM Invoices WHERE id = ? FOR UPDATE',
                [invoiceId]
            );
            if (invoices.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
            }

            const invoice = invoices[0];
            if (invoice.status === 'paid') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Hóa đơn này đã được thanh toán đủ.' });
            }

            if (invoice.status === 'cancelled') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Không thể thanh toán hóa đơn đã bị hủy.' });
            }

            const totalAmount = money(invoice.totalAmount);
            const paidAmount = money(invoice.paidAmount);
            const outstandingAmount = Math.max(totalAmount - paidAmount, 0);
            const paymentAmount = requestedAmount === null ? outstandingAmount : requestedAmount;

            if (paymentAmount <= 0 || paymentAmount > outstandingAmount) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Số tiền thanh toán không hợp lệ.' });
            }

            const nextPaidAmount = paidAmount + paymentAmount;
            const nextStatus = nextPaidAmount >= totalAmount ? 'paid' : 'partial';

            await connection.query(
                'UPDATE Invoices SET status = ?, paidAmount = ?, paymentMethod = ? WHERE id = ?',
                [nextStatus, nextPaidAmount, toInvoicePaymentMethod(paymentMethod), invoiceId]
            );

            const [paymentResult] = await connection.query(
                'INSERT INTO Payments (invoiceId, amount, paymentMethod, transactionId, status) VALUES (?, ?, ?, ?, "success")',
                [invoiceId, paymentAmount, paymentMethod, transactionId || null]
            );

            await connection.commit();

            await createNotification(
                pool,
                invoice.patientId,
                nextStatus === 'paid' ? 'Thanh toán thành công' : 'Hóa đơn đã được thanh toán một phần',
                `Hóa đơn #${invoiceId} đã ghi nhận thanh toán ${paymentAmount.toLocaleString('vi-VN')} đ.`,
                'payment'
            );
            await createNotificationsForRoles(
                pool,
                ['admin', 'staff'],
                nextStatus === 'paid' ? 'Hóa đơn đã thanh toán đủ' : 'Hóa đơn thanh toán một phần',
                `Hóa đơn #${invoiceId} đã ghi nhận thanh toán ${paymentAmount.toLocaleString('vi-VN')} đ.`,
                'payment'
            );

            res.json({
                success: true,
                message: nextStatus === 'paid' ? 'Thanh toán hóa đơn thành công.' : 'Đã ghi nhận thanh toán một phần.',
                data: {
                    paymentId: paymentResult.insertId,
                    invoiceId,
                    amount: paymentAmount,
                    paidAmount: nextPaidAmount,
                    outstandingAmount: Math.max(totalAmount - nextPaidAmount, 0),
                    status: nextStatus,
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
