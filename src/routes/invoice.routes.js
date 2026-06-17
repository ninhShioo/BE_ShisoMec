const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.use(verifyToken);

router.post('/', checkRole(['admin', 'staff']), logActivity('CREATE_INVOICE', 'Invoices'), invoiceController.createInvoice);
router.get('/', checkRole(['patient', 'admin', 'staff']), invoiceController.getAllInvoices);
router.put('/:id/pay', checkRole(['admin', 'staff']), logActivity('PAY_INVOICE', 'Invoices'), invoiceController.payInvoice);

module.exports = router;
