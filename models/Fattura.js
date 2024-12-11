const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const fatturaSchema = new Schema(
{
    tipo_documento: { type: String, required: true },
    ragione_sociale: { type: String, required: true },
    confermata: Boolean,
    anno: { type: Number, required: true },
    numero: { type: Number, required: true },
    data_fattura: { type: Date, required: true },
    codice: { type: String, required: true },
    destinazione: String,
    imponibile: Number,
    iva: Number,
    sconto_imponibile: Number,
    totale_fattura: Number,
    data_fattura_elettronica: Date,
    data_invio_fattura: Date,
    tipo_pagamento: String,
    cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' },
    scadenza: { type: Schema.Types.ObjectId, ref: 'Scadenza' }
});

module.exports = mongoose.model('Fattura', fatturaSchema);