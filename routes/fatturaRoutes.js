const express = require('express');
const router = express.Router();
const FatturaController = require('../controllers/FatturaController');

router.post('/', FatturaController.createFattura);
router.get('/', FatturaController.getFatture);
router.get('/:id', FatturaController.getFattura);
router.put('/:id', FatturaController.updateFattura);
router.delete('/:id', FatturaController.deleteFattura);
router.post('/:fatturaId/cliente/:clienteId', FatturaController.associateCliente);
router.post('/:fatturaId/servizio/:servizioId', FatturaController.associateServizio);
router.post('/:fatturaId/scadenza/:scadenzaId', FatturaController.associateScadenza);
router.get('/:id/servizi', FatturaController.getServiziAssociati);
router.get('/:id/cliente', FatturaController.getClienteAssociato);
router.get('/:id/scadenza', FatturaController.getScadenzaAssociata);

module.exports = router;