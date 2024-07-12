const express = require('express');
const router = express.Router();
const ArticoloController = require('../controllers/ArticoloController');

router.post('/', ArticoloController.createArticolo);
router.get('/', ArticoloController.getArticoli);
router.get('/:id', ArticoloController.getArticolo);
router.put('/:id', ArticoloController.updateArticolo);
router.delete('/:id', ArticoloController.deleteArticolo);
router.post('/:articoloId/servizi/:servizioId', ArticoloController.associateServizio);
router.get('/:articoloId/servizi', ArticoloController.getServiziAssociati);

module.exports = router;