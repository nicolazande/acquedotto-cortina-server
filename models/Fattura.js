const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const fatturaSchema = new Schema(
{
    tipo: { type: String, required: true },
    ragioneSociale: { type: String, required: true },
    anno: { type: Number, required: true },
    numero: { type: Number, required: true },
    data: { type: Date, required: true },
    confermata: { type: Boolean, default: false },
    codice: { type: String, required: true },
    cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' }
});

module.exports = mongoose.model('Fattura', fatturaSchema);