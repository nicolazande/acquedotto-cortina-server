const express = require('express');
const router = express.Router();
const ElencoController = require('../controllers/ElencoController');

// Prima di `/:formato`, altrimenti "riepilogo" verrebbe letto come un formato.
router.get('/:elenco/riepilogo', ElencoController.riepilogoElenco);
router.get('/:elenco/:formato', ElencoController.scaricaElenco);

module.exports = router;
