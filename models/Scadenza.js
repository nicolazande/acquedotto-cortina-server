const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const scadenzaSchema = new Schema(
{
    scadenza: { type: Date, required: true },
    saldo: { type: Boolean, required: true },
    pagamento: { type: Date, required: true },
    ritardo: { type: Number, required: false },
    anno: { type: Number, required: true },
    numero: { type: Number, required: true },
    cognome: { type: String, required: true },
    nome: { type: String, required: true },
    totale: { type: Number, required: true },
    solleciti: { type: Number, required: false },
});

module.exports = mongoose.model('Scadenza', scadenzaSchema);