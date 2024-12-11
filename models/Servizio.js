const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const servizioSchema = new Schema(
{
    riga: { type: Number, required: false },
    descrizione: { type: String, required: false },
    tipo_tariffa: { type: String, required: false },
    tipo_attivita: { type: String, required: false },
    metri_cubi: { type: Number, required: false },
    prezzo: { type: Number, required: false },
    valore_unitario: { type: Number, required: false },
    tipo_quota: { type: String, required: false },
    seriale_condominio: { type: String, required: false },
    lettura_precedente: { type: String, required: false },
    lettura_fatturazione: { type: String, required: false },
    data_lettura: { type: Date, required: false },
    descrizione_attivita: { type: String, required: false },
    lettura: { type: Schema.Types.ObjectId, ref: 'Lettura' },
    articolo: { type: Schema.Types.ObjectId, ref: 'Articolo' },
    fattura: { type: Schema.Types.ObjectId, ref: 'Fattura' }
});

module.exports = mongoose.model('Servizio', servizioSchema);