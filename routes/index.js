const express = require('express');
const router = express.Router();

const attachmentRoutes = require('./attachmentRoutes');
const authRoutes = require('./authRoutes');
const articoloRoutes = require('./articoloRoutes');
const clienteRoutes = require('./clienteRoutes');
const contatoreRoutes = require('./contatoreRoutes');
const customerPortalRoutes = require('./customerPortalRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const edificioRoutes = require('./edificioRoutes');
const fasciaRoutes = require('./fasciaRoutes');
const fatturaRoutes = require('./fatturaRoutes');
const letturaRoutes = require('./letturaRoutes');
const listinoRoutes = require('./listinoRoutes');
const servizioRoutes = require('./servizioRoutes');
const scadenzaRoutes = require('./scadenzaRoutes');
const AuthMiddleware = require('../middlewares/AuthMiddleware');
const { requireAdmin, requireCustomer } = require('../middlewares/AuthorizationMiddleware');

router.use('/auth', authRoutes);
router.use('/portale-cliente', AuthMiddleware, requireCustomer, customerPortalRoutes);

router.use(AuthMiddleware, requireAdmin);

router.use('/attachments', attachmentRoutes);
router.use('/articoli', articoloRoutes);
router.use('/clienti', clienteRoutes);
router.use('/panoramica', dashboardRoutes);
router.use('/contatori', contatoreRoutes);
router.use('/edifici', edificioRoutes);
router.use('/fasce', fasciaRoutes);
router.use('/fatture', fatturaRoutes);
router.use('/letture', letturaRoutes);
router.use('/listini', listinoRoutes);
router.use('/servizi', servizioRoutes);
router.use('/scadenze', scadenzaRoutes);

module.exports = router;
