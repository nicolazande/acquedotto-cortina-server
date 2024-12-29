const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const scadenzaSchema = new Schema(
    {
        scadenza: { type: Date, required: false },
        saldo: { type: Boolean, required: false },
        pagamento: { type: Date, required: false },
        ritardo: { type: Number, required: false },
        anno: { type: Number, required: false },
        numero: { type: Number, required: false },
        cognome: { type: String, required: false },
        nome: { type: String, required: false },
        totale: { type: Number, required: false },
        solleciti: { type: Number, required: false },
    },
    {
        collection: 'scadenze'
    }
);

module.exports = mongoose.model('Scadenza', scadenzaSchema);