const express = require('express');
const router = express.Router();
const ServizioController = require('../controllers/ServizioController');

router.post('/', ServizioController.createServizio);
router.get('/', ServizioController.getServizi);
router.get('/:id', ServizioController.getServizio);
router.put('/:id', ServizioController.updateServizio);
router.delete('/:id', ServizioController.deleteServizio);
router.post('/:servizioId/lettura/:letturaId', ServizioController.associateLettura);
router.post('/:servizioId/articolo/:articoloId', ServizioController.associateArticolo);
router.post('/:servizioId/fattura/:fatturaId', ServizioController.associateFattura);
router.get('/:id/lettura', ServizioController.getLetturaAssociata);
router.get('/:id/fattura', ServizioController.getFatturaAssociata);
router.get('/:id/articolo', ServizioController.getArticoloAssociato);

module.exports = router;