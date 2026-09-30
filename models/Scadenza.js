const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const scadenzaSchema = new Schema(
    {
        scadenza: { type: Date, required: false },
        saldo: { type: Boolean, required: false },
        pagamento: { type: Date, required: false },
        anno: { type: Number, required: false },
        numero: { type: Number, required: false },
        // La serie della fattura, per quelle emesse da questo gestionale: senza,
        // 2026/12 della serie nuova e 2025/12 dello storico si confondono.
        serie: { type: String, required: false },
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

// Come si riconosce una scadenza saldata. Sta qui, accanto al campo che
// descrive, perche il campo ha una storia: sui record importati dal gestionale
// precedente puo mancare del tutto, e assente significa non saldata. Chi lo
// dimentica conta come pagate scadenze che nessuno ha pagato.
//
// Due forme dello stesso fatto - una per le ricerche, una per le aggregazioni -
// tenute vicine perche devono dire la stessa cosa.
const SALDATA = { saldo: true };
const NON_SALDATA = { $or: [{ saldo: false }, { saldo: { $exists: false } }] };
const saldataExpression = () => ({ $eq: [{ $ifNull: ['$saldo', false] }, true] });

// Scaduta vuol dire che il giorno della scadenza e passato: da domani, non da
// stamattina, come il ritardo (`delayAggregation`), che conta i giorni interi.
// L'elenco delle scadenze e la panoramica ne avevano due versioni: il giorno
// della scadenza una la contava fra le scadute e l'altra no, e i due numeri non
// tornavano. Le date sono a mezzanotte UTC, come `startOfDay`.
const oggiUtc = (adesso = new Date()) => new Date(Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth(), adesso.getUTCDate()));
const SCADUTA = (adesso) => ({ scadenza: { $lt: oggiUtc(adesso) } });
const IN_ARRIVO = (adesso) => ({ scadenza: { $gte: oggiUtc(adesso) } });

const Scadenza = mongoose.model('Scadenza', scadenzaSchema);

module.exports = Scadenza;
module.exports.SALDATA = SALDATA;
module.exports.NON_SALDATA = NON_SALDATA;
module.exports.saldataExpression = saldataExpression;
module.exports.SCADUTA = SCADUTA;
module.exports.IN_ARRIVO = IN_ARRIVO;