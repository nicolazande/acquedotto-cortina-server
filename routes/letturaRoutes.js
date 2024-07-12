const express = require('express');
const router = express.Router();
const LetturaController = require('../controllers/LetturaController');

router.post('/', LetturaController.createLettura);
router.get('/', LetturaController.getLetture);
router.get('/:id', LetturaController.getLettura);
router.put('/:id', LetturaController.updateLettura);
router.delete('/:id', LetturaController.deleteLettura);
router.post('/:letturaId/contatore/:contatoreId', LetturaController.associateContatore);
router.get('/:letturaId/contatore', LetturaController.getContatoreAssociato);
router.get('/:letturaId/servizi', LetturaController.getServiziAssociati);

module.exports = router;