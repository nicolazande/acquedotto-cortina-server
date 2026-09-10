const express = require('express');
const router = express.Router();
const ElencoController = require('../controllers/ElencoController');

// Prima di `/bim/:formato`, altrimenti "riepilogo" verrebbe letto come un formato.
router.get('/bim/riepilogo', ElencoController.riepilogoElencoBim);
router.get('/bim/:formato', ElencoController.scaricaElencoBim);

module.exports = router;
