const express = require('express');
const router = express.Router();

const articoloRoutes = require('./articoloRoutes');
const clienteRoutes = require('./clienteRoutes');
const contatoreRoutes = require('./contatoreRoutes');
const edificioRoutes = require('./edificioRoutes');
const fasciaRoutes = require('./fasciaRoutes');
const fatturaRoutes = require('./fatturaRoutes');
const letturaRoutes = require('./letturaRoutes');
const listinoRoutes = require('./listinoRoutes');
const servizioRoutes = require('./servizioRoutes');

router.use('/articoli', articoloRoutes);
router.use('/clienti', clienteRoutes);
router.use('/contatori', contatoreRoutes);
router.use('/edifici', edificioRoutes);
router.use('/fasce', fasciaRoutes);
router.use('/fatture', fatturaRoutes);
router.use('/letture', letturaRoutes);
router.use('/listini', listinoRoutes);
router.use('/servizi', servizioRoutes);

module.exports = router;