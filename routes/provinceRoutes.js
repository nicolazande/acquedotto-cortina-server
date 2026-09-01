const express = require('express');
const router = express.Router();
const { PROVINCE } = require('../utils/province');

// L'elenco da cui il gestionale fa scegliere. Sta qui e non in una copia nel
// client perche e lo stesso elenco che converte la provincia in sigla per la
// fattura elettronica: cosi si puo scegliere soltanto una provincia che la
// fattura sa scrivere.
router.get('/', (req, res) => res.status(200).json({ data: PROVINCE }));

module.exports = router;
