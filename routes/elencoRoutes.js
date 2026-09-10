const express = require('express');
const router = express.Router();
const ElencoController = require('../controllers/ElencoController');

router.get('/bim/:formato', ElencoController.scaricaElencoBim);

module.exports = router;
