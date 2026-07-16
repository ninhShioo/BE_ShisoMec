const pool = require('../config/database');
const crypto = require('crypto');
const { createNotification, createNotificationsForRoles } = require('../services/notification.service');

const validPaymentMethods = ['cash', 'card', 'transfer'];
const validInvoicePaymentMethods = ['cash', 'card', 'transfer'];
const invoiceReadableRoles = ['admin', 'staff', 'patient'];
const vnpayDefaultPaymentUrl = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

const toInvoicePaymentMethod = (paymentMethod) => {
    if (paymentMethod === 'vnpay' || paymentMethod === 'momo') return 'transfer';
    return paymentMethod;
};

const money = (value) => {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
};

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

const getTodayDateOnly = () => vietnamDateFormatter.format(new Date());

const getActivePromotion = async (connectionOrPool, promotionId) => {
    const normalizedPromotionId = Number(promotionId);
    if (!Number.isInteger(normalizedPromotionId) || normalizedPromotionId <= 0) return null;

    const today = getTodayDateOnly();
    const [promotions] = await connectionOrPool.query(
        `SELECT id, name, discountPercent
         FROM Promotions
         WHERE id = ?
           AND isActive = 1
           AND (startDate IS NULL OR startDate <= ?)
           AND (endDate IS NULL OR endDate >= ?)
         LIMIT 1`,
        [normalizedPromotionId, today, today]
    );

    return promotions[0] || null;
};

const calculatePromotionDiscount = (subtotalAmount, promotion) => {
    if (!promotion) return 0;
    const discountPercent = Math.min(Math.max(Number(promotion.discountPercent || 0), 0), 100);
    return Math.min(money(subtotalAmount), Math.round((money(subtotalAmount) * discountPercent) / 100));
};

const normalizePublicUrl = (value, fallback) => {
    const candidates = String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const url = candidates.find((item) => /^https?:\/\//i.test(item));
    return (url || fallback).replace(/\/$/, '');
};

const getFrontendUrl = () => normalizePublicUrl(
    process.env.FRONTEND_URL || process.env.CORS_ORIGIN,
    'http://localhost:5173'
);

const getBackendUrl = () => normalizePublicUrl(
    process.env.BACKEND_URL,
    `http://localhost:${process.env.PORT || 8080}`
);

const isVnpayConfigured = () => Boolean(process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET);

const getClientIp = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) return String(forwardedFor).split(',')[0].trim();
    return req.socket?.remoteAddress || req.ip || '127.0.0.1';
};

const formatVnpayDate = (date = new Date()) => {
    const pad = (value) => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('');
};

const getVnpayExpireDate = (minutes = 15) => {
    const expireDate = new Date(Date.now() + minutes * 60 * 1000);
    return formatVnpayDate(expireDate);
};

const sortVnpayParams = (params) => Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .reduce((sorted, key) => {
        sorted[key] = String(params[key]);
        return sorted;
    }, {});

const encodeVnpayValue = (value) => encodeURIComponent(String(value)).replace(/%20/g, '+');

const buildVnpayQuery = (params) => Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeVnpayValue(params[key])}`)
    .join('&');

const signVnpayParams = (params) => {
    const sortedParams = Object.keys(sortVnpayParams(params)).reduce((encoded, key) => {
        encoded[encodeURIComponent(key)] = encodeVnpayValue(params[key]);
        return encoded;
    }, {});
    const signData = Object.keys(sortedParams)
        .map((key) => `${key}=${sortedParams[key]}`)
        .join('&');
    return crypto
        .createHmac('sha512', process.env.VNPAY_HASH_SECRET)
        .update(Buffer.from(signData, 'utf-8'))
        .digest('hex');
};

const verifyVnpaySignature = (query) => {
    if (!isVnpayConfigured()) return false;
    const params = { ...query };
    const secureHash = String(params.vnp_SecureHash || '').toLowerCase();
    delete params.vnp_SecureHash;
    delete params.vnp_SecureHashType;

    return secureHash === signVnpayParams(params);
};

const parseInvoiceIdFromTxnRef = (txnRef) => {
    const [invoiceId] = String(txnRef || '').split('-');
    const normalizedInvoiceId = Number(invoiceId);
    return Number.isInteger(normalizedInvoiceId) && normalizedInvoiceId > 0 ? normalizedInvoiceId : null;
};

const recordInvoicePayment = async (connection, invoiceId, paymentAmount, paymentMethod, transactionId) => {
    const [invoices] = await connection.query(
        'SELECT id, patientId, status, totalAmount, paidAmount FROM Invoices WHERE id = ? FOR UPDATE',
        [invoiceId]
    );

    if (invoices.length === 0) {
        return { ok: false, code: 'not_found', message: 'Không tìm thấy hóa đơn.' };
    }

    const invoice = invoices[0];
    if (invoice.status === 'paid') {
        return { ok: false, code: 'already_paid', message: 'Hóa đơn đã được thanh toán đủ.', invoice };
    }

    if (invoice.status === 'cancelled') {
        return { ok: false, code: 'cancelled', message: 'Hóa đơn đã bị hủy.', invoice };
    }

    const totalAmount = money(invoice.totalAmount);
    const paidAmount = money(invoice.paidAmount);
    const outstandingAmount = Math.max(totalAmount - paidAmount, 0);
    const safePaymentAmount = money(paymentAmount);

    if (safePaymentAmount <= 0 || safePaymentAmount > outstandingAmount) {
        return { ok: false, code: 'invalid_amount', message: 'Số tiền thanh toán không hợp lệ.', invoice };
    }

    const [existingPayments] = await connection.query(
        'SELECT id FROM Payments WHERE transactionId = ? AND status = "success" LIMIT 1',
        [transactionId]
    );
    if (transactionId && existingPayments.length > 0) {
        return { ok: false, code: 'already_confirmed', message: 'Giao dịch đã được ghi nhận.', invoice };
    }

    const nextPaidAmount = paidAmount + safePaymentAmount;
    const nextStatus = nextPaidAmount >= totalAmount ? 'paid' : 'partial';

    await connection.query(
        'UPDATE Invoices SET status = ?, paidAmount = ?, paymentMethod = ? WHERE id = ?',
        [nextStatus, nextPaidAmount, toInvoicePaymentMethod(paymentMethod), invoiceId]
    );

    const [paymentResult] = await connection.query(
        'INSERT INTO Payments (invoiceId, amount, paymentMethod, transactionId, status) VALUES (?, ?, ?, ?, "success")',
        [invoiceId, safePaymentAmount, paymentMethod, transactionId || null]
    );

    return {
        ok: true,
        invoice,
        paymentId: paymentResult.insertId,
        amount: safePaymentAmount,
        paidAmount: nextPaidAmount,
        outstandingAmount: Math.max(totalAmount - nextPaidAmount, 0),
        status: nextStatus,
        paymentMethod
    };
};

const notifyInvoicePayment = async (paymentResult, invoiceId) => {
    await createNotification(
        pool,
        paymentResult.invoice.patientId,
        paymentResult.status === 'paid' ? 'Thanh toán thành công' : 'Hóa đơn đã được thanh toán một phần',
        `Hóa đơn #${invoiceId} đã ghi nhận thanh toán ${paymentResult.amount.toLocaleString('vi-VN')} đ.`,
        'payment'
    );
    await createNotificationsForRoles(
        pool,
        ['admin', 'staff'],
        paymentResult.status === 'paid' ? 'Hóa đơn đã thanh toán đủ' : 'Hóa đơn thanh toán một phần',
        `Hóa đơn #${invoiceId} đã ghi nhận thanh toán ${paymentResult.amount.toLocaleString('vi-VN')} đ.`,
        'payment'
    );
};

const confirmVnpayPaymentFromParams = async (params) => {
    const invoiceId = parseInvoiceIdFromTxnRef(params.vnp_TxnRef);
    const validSignature = verifyVnpaySignature(params);
    const responseCode = String(params.vnp_ResponseCode || '');
    const transactionStatus = String(params.vnp_TransactionStatus || '');
    const success = validSignature && responseCode === '00' && transactionStatus === '00';

    const result = {
        success: false,
        status: 'failed',
        invoiceId,
        responseCode,
        message: 'Thanh toán VNPay chưa thành công hoặc chữ ký không hợp lệ.'
    };

    if (!validSignature) {
        result.message = 'Chữ ký VNPay không hợp lệ.';
        return result;
    }

    if (!invoiceId) {
        result.message = 'Không xác định được hóa đơn từ giao dịch VNPay.';
        return result;
    }

    if (!success) {
        result.message = 'VNPay trả về giao dịch chưa thành công.';
        return result;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const paymentAmount = money(params.vnp_Amount) / 100;
        const transactionId = String(params.vnp_TransactionNo || params.vnp_TxnRef || '');
        const paymentResult = await recordInvoicePayment(connection, invoiceId, paymentAmount, 'vnpay', transactionId);

        if (paymentResult.ok) {
            await connection.commit();
            await notifyInvoicePayment(paymentResult, invoiceId);
            return {
                ...result,
                success: true,
                status: 'success',
                message: 'Đã ghi nhận thanh toán VNPay.',
                payment: paymentResult
            };
        }

        await connection.rollback();
        if (['already_paid', 'already_confirmed'].includes(paymentResult.code)) {
            return {
                ...result,
                success: true,
                status: 'success',
                message: 'Giao dịch VNPay đã được ghi nhận trước đó.'
            };
        }

        return {
            ...result,
            message: paymentResult.message || 'Không thể ghi nhận giao dịch VNPay.'
        };
    } catch (error) {
        await connection.rollback();
        console.error('VNPay confirmation failed:', error.message);
        return {
            ...result,
            message: 'Không thể ghi nhận giao dịch VNPay.'
        };
    } finally {
        connection.release();
    }
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
            const requestBody = req.body || {};
            const appointmentId = Number(requestBody.appointmentId);
            const invoicePaymentMethod = requestBody.paymentMethod || 'cash';
            const discountAmount = money(requestBody.discountAmount);
            const promotionId = requestBody.promotionId === undefined || requestBody.promotionId === '' ? null : Number(requestBody.promotionId);
            const note = requestBody.note ? String(requestBody.note).trim() : null;

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
            const promotion = promotionId ? await getActivePromotion(connection, promotionId) : null;
            if (promotionId && !promotion) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Voucher không tồn tại, đã tắt hoặc đã hết hạn.' });
            }
            const voucherDiscount = calculatePromotionDiscount(subtotalAmount, promotion);
            const safeDiscount = Math.min(promotion ? voucherDiscount : discountAmount, subtotalAmount);
            const totalAmount = subtotalAmount - safeDiscount;

            if (totalAmount <= 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Tổng tiền hóa đơn không hợp lệ.' });
            }

            const [result] = await connection.query(
                `INSERT INTO Invoices
                 (appointmentId, patientId, subtotalAmount, discountAmount, promotionId, promotionName, promotionDiscountPercent, paidAmount, totalAmount, paymentMethod, status, note)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, "unpaid", ?)`,
                [
                    appointmentId,
                    appointment.patientId,
                    subtotalAmount,
                    safeDiscount,
                    promotion?.id || null,
                    promotion?.name || null,
                    promotion ? Number(promotion.discountPercent || 0) : 0,
                    totalAmount,
                    invoicePaymentMethod,
                    note
                ]
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
                    promotionId: promotion?.id || null,
                    promotionName: promotion?.name || null,
                    promotionDiscountPercent: promotion ? Number(promotion.discountPercent || 0) : 0,
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

    createVnpayPaymentUrl: async (req, res, next) => {
        try {
            if (!isVnpayConfigured()) {
                return res.status(503).json({
                    success: false,
                    message: 'Chưa cấu hình VNPay. Vui lòng thêm VNPAY_TMN_CODE và VNPAY_HASH_SECRET trong backend/.env.'
                });
            }

            const invoiceId = Number(req.params.id);
            if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
                return res.status(400).json({ success: false, message: 'ID hóa đơn không hợp lệ.' });
            }

            let query = 'SELECT id, patientId, status, totalAmount, paidAmount FROM Invoices WHERE id = ?';
            const params = [invoiceId];
            if (req.user.role === 'patient') {
                query += ' AND patientId = ?';
                params.push(req.user.id);
            }

            const [invoices] = await pool.query(query, params);
            if (invoices.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
            }

            const invoice = invoices[0];
            if (invoice.status === 'paid') {
                return res.status(400).json({ success: false, message: 'Hóa đơn đã thanh toán đủ.' });
            }
            if (invoice.status === 'cancelled') {
                return res.status(400).json({ success: false, message: 'Không thể thanh toán hóa đơn đã hủy.' });
            }

            const requestBody = req.body || {};
            const outstandingAmount = Math.max(money(invoice.totalAmount) - money(invoice.paidAmount), 0);
            const requestedAmount = requestBody.amount === undefined ? outstandingAmount : money(requestBody.amount);
            if (requestedAmount <= 0 || requestedAmount > outstandingAmount) {
                return res.status(400).json({ success: false, message: 'Số tiền thanh toán VNPay không hợp lệ.' });
            }

            const txnRef = `${invoiceId}-${Date.now()}`;
            const paymentUrl = process.env.VNPAY_PAYMENT_URL || vnpayDefaultPaymentUrl;
            const backendUrl = getBackendUrl();
            const returnUrl = process.env.VNPAY_RETURN_URL || `${backendUrl}/api/invoices/vnpay-return`;

            const vnpParams = sortVnpayParams({
                vnp_Version: '2.1.0',
                vnp_Command: 'pay',
                vnp_TmnCode: process.env.VNPAY_TMN_CODE,
                vnp_Amount: Math.round(requestedAmount * 100),
                vnp_CurrCode: 'VND',
                vnp_TxnRef: txnRef,
                vnp_OrderInfo: `Thanh toan hoa don ${invoiceId}`,
                vnp_OrderType: process.env.VNPAY_ORDER_TYPE || 'billpayment',
                vnp_Locale: 'vn',
                vnp_ReturnUrl: returnUrl,
                vnp_IpAddr: getClientIp(req),
                vnp_CreateDate: formatVnpayDate(),
                vnp_ExpireDate: getVnpayExpireDate()
            });

            const secureHash = signVnpayParams(vnpParams);
            const redirectUrl = `${paymentUrl}?${buildVnpayQuery({ ...vnpParams, vnp_SecureHash: secureHash })}`;

            res.json({
                success: true,
                message: 'Tạo link thanh toán VNPay thành công.',
                data: {
                    paymentUrl: redirectUrl,
                    txnRef,
                    invoiceId,
                    amount: requestedAmount
                }
            });
        } catch (error) {
            next(error);
        }
    },

    handleVnpayReturn: async (req, res) => {
        const confirmation = await confirmVnpayPaymentFromParams(req.query);
        const frontendUrl = getFrontendUrl();
        const params = new URLSearchParams({
            payment: confirmation.status,
            method: 'vnpay',
            invoiceId: confirmation.invoiceId ? String(confirmation.invoiceId) : '',
            responseCode: String(req.query.vnp_ResponseCode || '')
        });

        res.redirect(`${frontendUrl}/profile?${params.toString()}`);
    },

    confirmVnpayReturn: async (req, res) => {
        const confirmation = await confirmVnpayPaymentFromParams(req.body || {});
        res.status(confirmation.success ? 200 : 400).json({
            success: confirmation.success,
            message: confirmation.message,
            data: {
                status: confirmation.status,
                invoiceId: confirmation.invoiceId,
                responseCode: confirmation.responseCode
            }
        });
    },

    handleVnpayIpn: async (req, res, next) => {
        const connection = await pool.getConnection();
        try {
            if (!verifyVnpaySignature(req.query)) {
                return res.json({ RspCode: '97', Message: 'Invalid Checksum' });
            }

            const invoiceId = parseInvoiceIdFromTxnRef(req.query.vnp_TxnRef);
            if (!invoiceId) {
                return res.json({ RspCode: '01', Message: 'Order not found' });
            }

            const responseCode = String(req.query.vnp_ResponseCode || '');
            const transactionStatus = String(req.query.vnp_TransactionStatus || '');
            if (responseCode !== '00' || transactionStatus !== '00') {
                return res.json({ RspCode: '00', Message: 'Confirm Success' });
            }

            const paymentAmount = money(req.query.vnp_Amount) / 100;
            const transactionId = String(req.query.vnp_TransactionNo || req.query.vnp_TxnRef || '');

            await connection.beginTransaction();
            const paymentResult = await recordInvoicePayment(connection, invoiceId, paymentAmount, 'vnpay', transactionId);

            if (!paymentResult.ok) {
                await connection.rollback();
                if (paymentResult.code === 'not_found') return res.json({ RspCode: '01', Message: 'Order not found' });
                if (paymentResult.code === 'invalid_amount') return res.json({ RspCode: '04', Message: 'Invalid amount' });
                if (['already_paid', 'already_confirmed'].includes(paymentResult.code)) return res.json({ RspCode: '02', Message: 'Order already confirmed' });
                return res.json({ RspCode: '99', Message: 'Unknown error' });
            }

            await connection.commit();
            await notifyInvoicePayment(paymentResult, invoiceId);

            res.json({ RspCode: '00', Message: 'Confirm Success' });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    applyPromotion: async (req, res, next) => {
        const connection = await pool.getConnection();

        try {
            const invoiceId = Number(req.params.id);
            const requestBody = req.body || {};
            const promotionId = requestBody.promotionId === undefined || requestBody.promotionId === '' ? null : Number(requestBody.promotionId);

            if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
                return res.status(400).json({ success: false, message: 'ID hóa đơn không hợp lệ.' });
            }

            if (promotionId !== null && (!Number.isInteger(promotionId) || promotionId <= 0)) {
                return res.status(400).json({ success: false, message: 'Voucher không hợp lệ.' });
            }

            await connection.beginTransaction();

            const [invoices] = await connection.query(
                'SELECT id, patientId, status, subtotalAmount, totalAmount, paidAmount FROM Invoices WHERE id = ? FOR UPDATE',
                [invoiceId]
            );

            if (invoices.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
            }

            const invoice = invoices[0];
            if (invoice.status === 'paid' || invoice.status === 'partial' || money(invoice.paidAmount) > 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Chỉ áp voucher khi hóa đơn chưa ghi nhận thanh toán.' });
            }

            if (invoice.status === 'cancelled') {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Không thể áp voucher cho hóa đơn đã hủy.' });
            }

            const subtotalAmount = money(invoice.subtotalAmount || invoice.totalAmount);
            const promotion = promotionId ? await getActivePromotion(connection, promotionId) : null;
            if (promotionId && !promotion) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Voucher không tồn tại, đã tắt hoặc đã hết hạn.' });
            }

            const discountAmount = calculatePromotionDiscount(subtotalAmount, promotion);
            const totalAmount = Math.max(subtotalAmount - discountAmount, 0);

            if (totalAmount <= 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Voucher làm tổng hóa đơn không hợp lệ.' });
            }

            await connection.query(
                `UPDATE Invoices
                 SET discountAmount = ?,
                     promotionId = ?,
                     promotionName = ?,
                     promotionDiscountPercent = ?,
                     totalAmount = ?
                 WHERE id = ?`,
                [
                    discountAmount,
                    promotion?.id || null,
                    promotion?.name || null,
                    promotion ? Number(promotion.discountPercent || 0) : 0,
                    totalAmount,
                    invoiceId
                ]
            );

            await connection.commit();

            const itemsByInvoice = await getInvoiceItems(pool, invoiceId);
            const paymentsByInvoice = await getInvoicePayments(pool, invoiceId);
            const [updatedInvoices] = await pool.query('SELECT * FROM Invoices WHERE id = ?', [invoiceId]);

            res.json({
                success: true,
                message: promotion ? 'Đã áp voucher cho hóa đơn.' : 'Đã bỏ voucher khỏi hóa đơn.',
                data: mapInvoice(updatedInvoices[0], itemsByInvoice, paymentsByInvoice)
            });
        } catch (error) {
            await connection.rollback();
            next(error);
        } finally {
            connection.release();
        }
    },

    payInvoice: async (req, res, next) => {
        const connection = await pool.getConnection();

        try {
            const invoiceId = Number(req.params.id);
            const requestBody = req.body || {};
            const { paymentMethod = 'cash', transactionId = null } = requestBody;
            const requestedAmount = requestBody.amount === undefined ? null : money(requestBody.amount);

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
            const paymentResult = await recordInvoicePayment(connection, invoiceId, paymentAmount, paymentMethod, transactionId || `manual-${invoiceId}-${Date.now()}`);

            if (!paymentResult.ok) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: paymentResult.message });
            }

            await connection.commit();
            await notifyInvoicePayment(paymentResult, invoiceId);

            res.json({
                success: true,
                message: paymentResult.status === 'paid' ? 'Thanh toán hóa đơn thành công.' : 'Đã ghi nhận thanh toán một phần.',
                data: {
                    paymentId: paymentResult.paymentId,
                    invoiceId,
                    amount: paymentResult.amount,
                    paidAmount: paymentResult.paidAmount,
                    outstandingAmount: paymentResult.outstandingAmount,
                    status: paymentResult.status,
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
