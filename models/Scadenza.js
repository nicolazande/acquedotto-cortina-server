const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const scadenzaSchema = new Schema(
{
    dataScadenza: { type: Date, required: true },
    importo: { type: Number, required: true },
    saldo: { type: Boolean, default: false },
    dataPagamento: { type: Date },
    ritardo: { type: Boolean, default: false },
    fattura: { type: Schema.Types.ObjectId, ref: 'Fattura' }
});

module.exports = mongoose.model('Scadenza', scadenzaSchema);