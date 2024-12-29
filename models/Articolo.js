const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const articoloSchema = new Schema(
  {
    codice: { type: String, required: true },
    descrizione: { type: String, required: true },
    iva: { type: Number, required: true }
  },
  {
    collection: 'articoli'
  }
);

module.exports = mongoose.model('Articolo', articoloSchema);
