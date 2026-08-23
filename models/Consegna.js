const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Una consegna e il recapito di una fattura su un canale.
//
// Esiste come record e non come semplice data sulla fattura perche i canali
// sono due e indipendenti: la copia di cortesia puo essere partita per email
// mentre la fattura elettronica e ancora da trasmettere, e un tentativo fallito
// deve restare visibile con il suo motivo invece di sparire.
//
// Il gestionale precedente teneva la stessa informazione in due date sulla
// fattura (`data_invio_fattura` e `data_fattura_elettronica`): quelle restano
// popolate per compatibilita, ma la verita sullo stato dell'invio e qui.
const consegnaSchema = new Schema(
    {
        fattura: { type: Schema.Types.ObjectId, ref: 'Fattura', required: true },
        cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' },
        // Cosa si consegna: la copia di cortesia o il documento fiscale.
        tipo: { type: String, enum: ['cortesia', 'elettronica'], required: true },
        // Su quale strada. I valori sono quelli dichiarati in config/delivery.js.
        canale: {
            type: String,
            enum: ['email', 'pec', 'sdi', 'cassetto', 'postale', 'sportello'],
            required: true,
        },
        destinatario: { type: String },
        documento: { type: String },
        intestatario: { type: String },
        stato: {
            type: String,
            enum: ['in_coda', 'inviata', 'errore', 'annullata'],
            default: 'in_coda',
        },
        // Un canale non automatico (posta, sportello) resta in coda finche una
        // persona non dichiara di averlo evaso: e l'elenco delle buste da fare.
        automatica: { type: Boolean, default: false },
        tentativi: { type: Number, default: 0 },
        ultimo_errore: { type: String },
        data_invio: { type: Date },
        // Identificativo restituito dal trasporto: message-id della mail o
        // protocollo dello SdI. Serve per ritrovare la consegna fuori di qui.
        riferimento: { type: String },
        // Vero quando la consegna e stata registrata in modalita prova, cioe
        // senza che nulla sia realmente uscito.
        simulata: { type: Boolean, default: false },
        allegati: [{ type: String }],
        note: { type: String },
    },
    {
        collection: 'consegne',
        timestamps: true,
    }
);

// Una fattura ha al massimo una consegna per tipo: reimpostare il piano
// aggiorna quella esistente invece di accodarne una seconda.
consegnaSchema.index({ fattura: 1, tipo: 1 }, { unique: true });
consegnaSchema.index({ stato: 1, automatica: 1 });
consegnaSchema.index({ cliente: 1, createdAt: -1 });

module.exports = mongoose.model('Consegna', consegnaSchema);
