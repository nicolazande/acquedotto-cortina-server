const express = require('express');
const router = express.Router();
const EdificioController = require('../controllers/EdificioController');

router.post('/', EdificioController.createEdificio);
router.get('/', EdificioController.getEdifici);
router.get('/:id', EdificioController.getEdificio);
router.put('/:id', EdificioController.updateEdificio);
router.delete('/:id', EdificioController.deleteEdificio);
router.post('/:edificioId/contatori/:contatoreId', EdificioController.associateContatore);
router.get('/:edificioId/contatori', EdificioController.getContatoriAssociati);

module.exports = router;