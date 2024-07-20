const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const fasciaSchema = new Schema(
{
    tipo: { type: String, required: true },
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    prezzo: { type: Number, required: true },
    scadenza: Date,
    fisso: Number,
    listino: { type: Schema.Types.ObjectId, ref: 'Listino' }
});

module.exports = mongoose.model('Fascia', fasciaSchema);