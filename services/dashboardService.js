const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const Scadenza = require('../models/Scadenza');
const { delayAggregation } = require('./deadlineService');
const { fromCents, toCents } = require('../utils/money');
const { startOfDay } = require('../utils/dates');

// Le letture non ancora fatturate: il flag puo mancare del tutto sui record importati.
const LETTURE_DA_FATTURARE = { $or: [{ fatturata: false }, { fatturata: { $exists: false } }] };

// `saldo` e salvato a volte come booleano e a volte come 1/0: $toBool uniforma
// il confronto, mentre un $match diretto su false ne perderebbe la maggior parte.
const scadenzeAperte = (soloScadute) => [
    {
        $addFields: {
            saldata: { $toBool: { $ifNull: ['$saldo', false] } },
            ritardo: delayAggregation(),
        },
    },
    {
        $match: {
            saldata: false,
            ...(soloScadute ? { ritardo: { $gt: 0 } } : {}),
        },
    },
];

const riepilogoImporti = [
    {
        $group: {
            _id: null,
            quante: { $sum: 1 },
            // Gli importi si sommano in centesimi interi per non accumulare errore.
            centesimi: { $sum: { $round: [{ $multiply: [{ $ifNull: ['$totale', 0] }, 100] }, 0] } },
            ritardoMassimo: { $max: '$ritardo' },
        },
    },
];

const primaRiga = (righe) => righe[0] || { quante: 0, centesimi: 0, ritardoMassimo: 0 };

const importi = (riga) => ({
    quante: riga.quante,
    totale: fromCents(riga.centesimi),
});

const getDashboard = async () => {
    const [
        daFatturare,
        bozze,
        aperte,
        scadute,
        clienti,
        contatoriAttivi,
    ] = await Promise.all([
        Lettura.countDocuments(LETTURE_DA_FATTURARE),
        Fattura.countDocuments({ stato: 'bozza' }),
        Scadenza.aggregate([...scadenzeAperte(false), ...riepilogoImporti]),
        Scadenza.aggregate([...scadenzeAperte(true), ...riepilogoImporti]),
        Cliente.estimatedDocumentCount(),
        Contatore.countDocuments({ inattivo: { $ne: true } }),
    ]);

    const rigaAperte = primaRiga(aperte);
    const rigaScadute = primaRiga(scadute);

    return {
        aggiornatoAl: new Date(),
        letture: { daFatturare },
        fatture: { bozze },
        incassi: {
            aperte: importi(rigaAperte),
            scadute: {
                ...importi(rigaScadute),
                ritardoMassimo: rigaScadute.ritardoMassimo || 0,
            },
        },
        anagrafiche: { clienti, contatoriAttivi },
    };
};

module.exports = {
    getDashboard,
    // esportati per i test
    LETTURE_DA_FATTURARE,
    scadenzeAperte,
};
