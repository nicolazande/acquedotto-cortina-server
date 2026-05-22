const express = require('express');
const CustomerPortalController = require('../controllers/CustomerPortalController');

const router = express.Router();

router.get('/', CustomerPortalController.getPortalData);
router.get('/fatture/:id/pdf', CustomerPortalController.downloadInvoicePdf);

module.exports = router;
