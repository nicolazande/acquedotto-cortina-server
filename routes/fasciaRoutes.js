const express = require('express');
const router = express.Router();
const FasciaController = require('../controllers/FasciaController');

router.post('/', FasciaController.createFascia);
router.get('/', FasciaController.getFasce);
router.get('/:id', FasciaController.getFascia);
router.put('/:id', FasciaController.updateFascia);
router.delete('/:id', FasciaController.deleteFascia);
router.post('/:fasciaId/listini/:listinoId', FasciaController.associateListino);

module.exports = router;