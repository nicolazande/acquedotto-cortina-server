const express = require('express');
const router = express.Router();
const ClienteController = require('../controllers/ClienteController');

router.post('/', ClienteController.createCliente);
router.get('/', ClienteController.getClienti);
router.get('/:id', ClienteController.getCliente);
router.put('/:id', ClienteController.updateCliente);
router.delete('/:id', ClienteController.deleteCliente);
router.post('/:clienteId/contatori/:contatoreId', ClienteController.associateContatore);
router.post('/:clienteId/fatture/:fatturaId', ClienteController.associateFattura);
router.get('/:id/contatori', ClienteController.getContatoriAssociati);
router.get('/:id/fatture', ClienteController.getFattureAssociate);

module.exports = router;