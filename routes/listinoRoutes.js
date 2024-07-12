const express = require('express');
const router = express.Router();
const ListinoController = require('../controllers/ListinoController');

router.post('/', ListinoController.createListino);
router.get('/', ListinoController.getListini);
router.get('/:id', ListinoController.getListino);
router.put('/:id', ListinoController.updateListino);
router.delete('/:id', ListinoController.deleteListino);
router.post('/:listinoId/fasce/:fasciaId', ListinoController.associateFascia);
router.get('/:listinoId/fasce', ListinoController.getFasceAssociate);
router.post('/:listinoId/contatori/:contatoreId', ListinoController.associateContatore);
router.get('/:listinoId/contatori', ListinoController.getContatoriAssociati);

module.exports = router;