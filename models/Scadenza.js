const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const scadenzaSchema = new Schema(
    {
        scadenza: { type: Date, required: false },
        saldo: { type: Boolean, required: false },
        pagamento: { type: Date, required: false },
        anno: { type: Number, required: false },
        numero: { type: Number, required: false },
        cognome: { type: String, required: false },
        nome: { type: String, required: false },
        totale: { type: Number, required: false },
        solleciti: { type: Number, required: false },
        // La penale per il ritardo di questa scadenza e gia stata addebitata.
        // Senza questa memoria, un cliente fatturato due volte mentre la stessa
        // scadenza resta aperta la paga due volte: il gestionale precedente
        // teneva il campo "Fatturato ritardo" esattamente per questo.
        mora_fatturata: { type: Boolean, required: false },
    },
    {
        collection: 'scadenze'
    }
);

// `ritardo` non e un campo salvato: dipende da oggi, quindi invecchierebbe di un
// giorno al giorno. Viene calcolato a ogni lettura (withComputedDelay) e, per
// l'ordinamento, direttamente da MongoDB (delayAggregation).

scadenzaSchema.index({ scadenza: 1 });
scadenzaSchema.index({ anno: 1, numero: 1 });
scadenzaSchema.index({ saldo: 1, scadenza: 1 });

module.exports = mongoose.model('Scadenza', scadenzaSchema);