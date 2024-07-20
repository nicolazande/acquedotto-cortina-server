const express = require('express');
const router = express.Router();
const LetturaController = require('../controllers/LetturaController');

router.post('/', LetturaController.createLettura);
router.get('/', LetturaController.getLetture);
router.get('/:id', LetturaController.getLettura);
router.put('/:id', LetturaController.updateLettura);
router.delete('/:id', LetturaController.deleteLettura);
router.post('/:letturaId/contatori/:contatoreId', LetturaController.associateContatore);
router.post('/:letturaId/servizi/:servizioId', LetturaController.associateServizio);
router.get('/:id/contatore', LetturaController.getContatoreAssociato);
router.get('/:id/servizi', LetturaController.getServiziAssociati);

module.exports = router;