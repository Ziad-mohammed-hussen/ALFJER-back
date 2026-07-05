const express = require('express');
const { generateInvoice, getInvoices, payInvoice, approveAllInvoices } = require('../controllers/invoiceController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/generate', protect, restrictTo('Admin'), generateInvoice);
router.get('/', protect, restrictTo('Admin', 'Parent'), getInvoices);
router.put('/approve-all', protect, restrictTo('Admin'), approveAllInvoices);
router.put('/:id/pay', protect, restrictTo('Admin', 'Parent'), payInvoice);

module.exports = router;
