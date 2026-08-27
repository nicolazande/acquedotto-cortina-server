const express = require('express');
const router = express.Router();
const ConsegnaController = require('../controllers/ConsegnaController');

router.get('/', ConsegnaController.getConsegne);
router.get('/riepilogo', ConsegnaController.getRiepilogo);
router.post('/pianifica', ConsegnaController.pianifica);
router.post('/elabora', ConsegnaController.elabora);
router.post('/stampa', ConsegnaController.stampa);
router.post('/xml', ConsegnaController.scaricaXml);
router.post('/prova-trasporto', ConsegnaController.provaTrasporto);
router.post('/:id/evasa', ConsegnaController.segnaConsegnata);
router.post('/:id/coda', ConsegnaController.rimettiInCoda);
router.post('/:id/annulla', ConsegnaController.annulla);

module.exports = router;
