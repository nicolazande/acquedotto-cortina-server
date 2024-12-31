const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const fatturaSchema = new Schema(
    {
        tipo_documento: { type: String, required: false },
        ragione_sociale: { type: String, required: false },
        confermata: { type: Boolean, required: false },
        anno: { type: Number, required: false },
        numero: { type: Number, required: false },
        data_fattura: { type: Date, required: false },
        codice: { type: String, required: false },
        destinazione: { type: String, required: false },
        imponibile: { type: Number, required: false },
        iva: { type: Number, required: false },
        sconto_imponibile: { type: Number, required: false },
        totale_fattura: { type: Number, required: false },
        data_fattura_elettronica: { type: Date, required: false },
        data_invio_fattura: { type: Date, required: false },
        tipo_pagamento: { type: String, required: false },
        cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' },
        scadenza: { type: Schema.Types.ObjectId, ref: 'Scadenza' }
    },
    {
        collection: 'fatture'
    }
);

module.exports = mongoose.model('Fattura', fatturaSchema);