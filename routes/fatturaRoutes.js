const express = require('express');
const router = express.Router();
const FatturaController = require('../controllers/FatturaController');
const ConsegnaController = require('../controllers/ConsegnaController');

router.post('/', FatturaController.createFattura);
router.post('/genera-da-letture', FatturaController.generateFromReadings);
router.get('/generazione/anteprima', FatturaController.getGenerationPreview);
router.get('/controlli', FatturaController.getControlDashboard);
router.get('/', FatturaController.getFatture);
router.get('/:id/verifica-calcolo', FatturaController.verifyCalcolo);
router.get('/:id/audit', FatturaController.getAuditLog);
router.post('/:id/quota-fissa', FatturaController.applyFixedCharge);
router.get('/:id/pdf', FatturaController.downloadPdf);
router.get('/:id/xml', FatturaController.downloadXml);
router.get('/:id/consegne', ConsegnaController.getAnteprima);
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
