const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.get('/vnpay-return', invoiceController.handleVnpayReturn);
router.get('/vnpay-ipn', invoiceController.handleVnpayIpn);
router.post('/vnpay-confirm', invoiceController.confirmVnpayReturn);

router.use(verifyToken);

router.post('/', checkRole(['admin', 'staff']), logActivity('CREATE_INVOICE', 'Invoices'), invoiceController.createInvoice);
router.get('/', checkRole(['patient', 'admin', 'staff']), invoiceController.getAllInvoices);
router.post('/:id/vnpay-url', checkRole(['patient', 'admin', 'staff']), invoiceController.createVnpayPaymentUrl);
router.get('/:id', checkRole(['patient', 'admin', 'staff']), invoiceController.getInvoiceById);
router.put('/:id/promotion', checkRole(['admin', 'staff']), logActivity('APPLY_INVOICE_PROMOTION', 'Invoices'), invoiceController.applyPromotion);
router.put('/:id/pay', checkRole(['admin', 'staff']), logActivity('PAY_INVOICE', 'Invoices'), invoiceController.payInvoice);

module.exports = router;
