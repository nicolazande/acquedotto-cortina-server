const Cliente = require('../models/Cliente');
const Consegna = require('../models/Consegna');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const Scadenza = require('../models/Scadenza');
const AuditLog = require('../models/AuditLog');
const { delayAggregation } = require('./deadlineService');
const { saldataExpression } = require('../models/Scadenza');
const { fromCents } = require('../utils/money');
const { tariffeInScadenza } = require('./tariffService');

// Le letture non ancora fatturate: il flag puo mancare del tutto sui record importati.
const LETTURE_DA_FATTURARE = { $or: [{ fatturata: false }, { fatturata: { $exists: false } }] };

// Lo stato della scadenza e la formula del ritardo arrivano da deadlineService,
// che e l'unico posto in cui sono definiti.
const scadenzeAperte = (soloScadute) => [
    {
        $addFields: {
            saldata: saldataExpression(),
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

// Fasce di anzianita del credito. L'ordine porta significato: piu si scende,
// piu il recupero e difficile. Serve a capire dove sta il rischio, non solo
// quanto si deve incassare.
const FASCE_SCADUTO = [
    { id: 'entro-30', etichetta: 'Fino a 30 giorni', da: 1, a: 30 },
    { id: 'entro-90', etichetta: 'Da 31 a 90 giorni', da: 31, a: 90 },
    { id: 'entro-365', etichetta: 'Da 91 giorni a 1 anno', da: 91, a: 365 },
    { id: 'oltre-365', etichetta: 'Oltre un anno', da: 366, a: null },
];

const fasciaDiRitardo = {
    $switch: {
        branches: FASCE_SCADUTO.slice(0, -1).map((fascia) => ({
            case: { $lte: ['$ritardo', fascia.a] },
            then: fascia.id,
        })),
        default: FASCE_SCADUTO[FASCE_SCADUTO.length - 1].id,
    },
};

const perFascia = (righe) => {
    const indice = new Map(righe.map((riga) => [riga._id, riga]));

    return FASCE_SCADUTO.map(({ id, etichetta }) => {
        const riga = indice.get(id);
        return {
            id,
            etichetta,
            quante: riga?.quante || 0,
            totale: fromCents(riga?.centesimi || 0),
        };
    });
};

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
        fasce,
        daSollecitare,
        consegne,
        tariffe,
        attivita,
    ] = await Promise.all([
        Lettura.countDocuments(LETTURE_DA_FATTURARE),
        Fattura.countDocuments({ stato: 'bozza' }),
        Scadenza.aggregate([...scadenzeAperte(false), ...riepilogoImporti]),
        Scadenza.aggregate([...scadenzeAperte(true), ...riepilogoImporti]),
        Cliente.estimatedDocumentCount(),
        Contatore.countDocuments({ inattivo: { $ne: true } }),
        Scadenza.aggregate([
            ...scadenzeAperte(true),
            { $addFields: { fascia: fasciaDiRitardo } },
            {
                $group: {
                    _id: '$fascia',
                    quante: { $sum: 1 },
                    centesimi: { $sum: { $round: [{ $multiply: [{ $ifNull: ['$totale', 0] }, 100] }, 0] } },
                },
            },
        ]),
        // I crediti piu grossi fra quelli scaduti: sono le telefonate da fare per prime.
        Scadenza.aggregate([
            ...scadenzeAperte(true),
            { $sort: { totale: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: Fattura.collection.collectionName,
                    localField: '_id',
                    foreignField: 'scadenza',
                    as: 'fattura',
                },
            },
            { $unwind: { path: '$fattura', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    ritardo: 1,
                    totale: 1,
                    scadenza: 1,
                    cliente: '$fattura.cliente',
                    nome: {
                        $trim: {
                            input: {
                                $concat: [{ $ifNull: ['$cognome', ''] }, ' ', { $ifNull: ['$nome', ''] }],
                            },
                        },
                    },
                    fattura: '$fattura._id',
                    anno: '$fattura.anno',
                    numero: '$fattura.numero',
                },
            },
        ]),
        // Le fatture ancora da recapitare, divise fra quelle che partono da sole
        // e quelle che aspettano una persona (stampa, sportello).
        Consegna.aggregate([
            { $match: { stato: { $in: ['in_coda', 'errore'] } } },
            { $group: { _id: { stato: '$stato', automatica: '$automatica' }, quante: { $sum: 1 } } },
        ]),
        // Le tariffe scadono, e con loro si ferma la fatturazione: e la cosa
        // che conviene vedere con mesi di anticipo, non il giorno stesso.
        tariffeInScadenza(),
        // Le ultime modifiche registrate: rende visibile chi ha toccato cosa.
        AuditLog.find({})
            .sort({ createdAt: -1 })
            .limit(6)
            .select('action summary actorUsername createdAt entityType entityId')
            .lean(),
    ]);

    const consegneCon = (filtro) => consegne
        .filter(filtro)
        .reduce((totale, riga) => totale + riga.quante, 0);

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
        scaduto: { fasce: perFascia(fasce) },
        daSollecitare,
        tariffe: {
            inScadenza: tariffe.length,
            scadute: tariffe.filter((voce) => voce.scaduto).length,
            contatori: tariffe.reduce((totale, voce) => totale + voce.contatori, 0),
            prossimaScadenza: tariffe[0]?.scadeIl || null,
            listini: tariffe.slice(0, 5).map(({ listino, categoria, contatori, scadeIl, scaduto }) => ({
                listino, categoria, contatori, scadeIl, scaduto,
            })),
        },
        consegne: {
            automatiche: consegneCon((riga) => riga._id.stato === 'in_coda' && riga._id.automatica === true),
            daStampare: consegneCon((riga) => riga._id.stato === 'in_coda' && riga._id.automatica !== true),
            errori: consegneCon((riga) => riga._id.stato === 'errore'),
        },
        attivita,
    };
};

module.exports = {
    getDashboard,
};
