const express = require('express');
const router = express.Router();

const attachmentRoutes = require('./attachmentRoutes');
const authRoutes = require('./authRoutes');
const articoloRoutes = require('./articoloRoutes');
const clienteRoutes = require('./clienteRoutes');
const consegnaRoutes = require('./consegnaRoutes');
const contatoreRoutes = require('./contatoreRoutes');
const customerPortalRoutes = require('./customerPortalRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const edificioRoutes = require('./edificioRoutes');
const fasciaRoutes = require('./fasciaRoutes');
const fatturaRoutes = require('./fatturaRoutes');
const letturaRoutes = require('./letturaRoutes');
const listinoRoutes = require('./listinoRoutes');
const provinceRoutes = require('./provinceRoutes');
const servizioRoutes = require('./servizioRoutes');
const scadenzaRoutes = require('./scadenzaRoutes');
const AuthMiddleware = require('../middlewares/AuthMiddleware');
const {
    anchePerLetturista,
    requireAdmin,
    requireCustomer,
} = require('../middlewares/AuthorizationMiddleware');

router.use('/auth', authRoutes);
router.use('/portale-cliente', AuthMiddleware, requireCustomer, customerPortalRoutes);

// Da qui in poi bisogna essere entrati. Il ruolo si decide risorsa per risorsa,
// e l'ordine e la protezione: sotto la riga `requireAdmin` tutto e riservato
// all'amministratore, quindi una rotta aggiunta domani nasce chiusa. Le poche
// aperte al letturista stanno sopra, elencate una per una.
router.use(AuthMiddleware);

router.use('/edifici', anchePerLetturista('edifici'), edificioRoutes);
router.use('/contatori', anchePerLetturista('contatori'), contatoreRoutes);
router.use('/clienti', anchePerLetturista('clienti'), clienteRoutes);
router.use('/letture', anchePerLetturista('letture'), letturaRoutes);
// Gli allegati servono tutte le risorse con una rotta sola: il permesso lo
// decide il controller, guardando a cosa e attaccata la nota.
router.use('/attachments', attachmentRoutes);

router.use(requireAdmin);

router.use('/articoli', articoloRoutes);
router.use('/panoramica', dashboardRoutes);
router.use('/consegne', consegnaRoutes);
router.use('/fasce', fasciaRoutes);
router.use('/fatture', fatturaRoutes);
router.use('/listini', listinoRoutes);
router.use('/province', provinceRoutes);
router.use('/servizi', servizioRoutes);
router.use('/scadenze', scadenzaRoutes);

module.exports = router;
