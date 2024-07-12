const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const servizioSchema = new Schema(
{
    descrizione: { type: String, required: true },
    valore: { type: Number, required: true },
    tariffa: { type: Number, required: true },
    m3: Number,
    prezzo: Number,
    seriale: String,
    lettura: { type: Schema.Types.ObjectId, ref: 'Lettura' },
    articolo: { type: Schema.Types.ObjectId, ref: 'Articolo' },
    fattura: { type: Schema.Types.ObjectId, ref: 'Fattura' }
});

module.exports = mongoose.model('Servizio', servizioSchema);