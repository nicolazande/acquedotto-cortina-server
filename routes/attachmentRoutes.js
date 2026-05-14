const express = require('express');
const NoteAttachmentController = require('../controllers/NoteAttachmentController');

const router = express.Router();

router.get('/:id/file', NoteAttachmentController.file);
router.delete('/:id', NoteAttachmentController.remove);
router.get('/:resource/:recordId', NoteAttachmentController.list);
router.post('/:resource/:recordId', NoteAttachmentController.create);

module.exports = router;
