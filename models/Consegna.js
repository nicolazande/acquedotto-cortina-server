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
        // Il progressivo con cui il file e stato trasmesso allo SdI. Cambia a
        // ogni tentativo: il nome del file deve essere nuovo, altrimenti la
        // rispedizione viene rifiutata come gia inviata.
        progressivo: { type: String },
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
        // Cosa manca perche possa partire, secondo il piano di oggi: un
        // recapito, un cliente estero che il tracciato non gestisce. Lo scrive e
        // lo toglie Prepara.
        problema: { type: String },
        // Cosa e andato storto all'ultimo tentativo di farla uscire: l'invio, il
        // file XML, la stampa. Lo toglie un tentativo riuscito o Riprova, non
        // Prepara: altrimenti un errore sparirebbe dalla riga senza essere risolto.
        ultimo_errore: { type: String },
        data_invio: { type: Date },
        // L'ultimo tentativo che non l'ha consegnata: una prova (posta non attiva,
        // o deviata sull'indirizzo di prova) oppure un errore. L'elaborazione
        // parte da quelle mai tentate e poi da quelle tentate da piu tempo:
        // altrimenti ripeterebbe sempre le stesse - le prove, o gli errori in cima
        // alla coda - e il resto non verrebbe mai raggiunto.
        ultimo_tentativo: { type: Date },
        // Identificativo restituito dal trasporto: message-id della mail o
        // protocollo dello SdI. Serve per ritrovare la consegna fuori di qui.
        riferimento: { type: String },
        // Messa in coda dalla scheda della fattura, per quella fattura, e non
        // dal Prepara generale. Conta per le fatture del vecchio programma: la
        // coda generale non le prepara, e non deve togliere quelle che una
        // persona ha chiesto apposta.
        su_richiesta: { type: Boolean, default: false },
        // Annullata da Prepara perche il piano non la prevedeva piu - fattura
        // riportata a bozza, cliente senza recapito, gia consegnata - e non da una
        // persona. Se il piano torna a prevederla, Prepara la rimette in coda;
        // una consegna annullata a mano resta annullata.
        chiusa_dal_piano: { type: Boolean },
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
