const express = require('express');
const router = express.Router();
const ScadenzaController = require('../controllers/ScadenzaController');

router.post('/', ScadenzaController.createScadenza);
router.get('/', ScadenzaController.getScadenze);
router.post('/incassi', ScadenzaController.registraIncassi);
router.post('/incassi/annulla', ScadenzaController.annullaIncassi);
router.get('/:id', ScadenzaController.getScadenza);
router.put('/:id', ScadenzaController.updateScadenza);
router.delete('/:id', ScadenzaController.deleteScadenza);
router.post('/:scadenzaId/fattura/:fatturaId', ScadenzaController.associateFattura);
router.get('/:id/fattura', ScadenzaController.getFatturaAssociata);

module.exports = router;