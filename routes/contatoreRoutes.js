const express = require('express');
const router = express.Router();
const ContatoreController = require('../controllers/ContatoreController');

router.post('/', ContatoreController.createContatore);
router.get('/', ContatoreController.getContatori);
router.get('/:id', ContatoreController.getContatore);
router.put('/:id', ContatoreController.updateContatore);
router.delete('/:id', ContatoreController.deleteContatore);
router.post('/:contatoreId/clienti/:clienteId', ContatoreController.associateCliente);
router.post('/:contatoreId/edifici/:edificioId', ContatoreController.associateEdificio);
router.post('/:contatoreId/listini/:listinoId', ContatoreController.associateListino);
router.get('/:id/listino', ContatoreController.getListinoAssociato);
router.get('/:id/edificio', ContatoreController.getEdificioAssociato);
router.get('/:id/letture', ContatoreController.getLettureAssociate);
router.get('/:id/cliente', ContatoreController.getClienteAssociato);

module.exports = router;