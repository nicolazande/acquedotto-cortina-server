// Cosa si fatturerebbe, se si fatturasse adesso. Nessuna scrittura: si legge
// quali letture sono pronte, si calcola quanto verrebbero, e si raggruppa per
// cliente - un cliente, una fattura.
//
// Serve alla pagina di generazione, che mostra i gruppi prima di crearli, e alla
// scheda del cliente: il motore e lo stesso, cosi le due non raccontano cose
// diverse. Sta fuori dalla generazione perche non crea niente: chi legge questo
// file non deve chiedersi se sta anche scrivendo.
//
// Oltre agli importi l'anteprima dice cosa guardare prima di generare:
// - le letture che non si fatturano in automatico (anomalie): un calcolo che
//   non riesce, una lettura piu vecchia di una gia fatturata;
// - quelle che si possono fatturare ma vanno controllate (avvisi): un anno gia
//   chiuso, un consumo fuori misura. Il cliente e "da verificare", e la
//   selezione di tutti lo lascia fuori;
// - la mora che la fattura porterebbe, cliente per cliente.

const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Lettura = require('../models/Lettura');
const {
    buildAnnualFixedLookupCache,
    createAnnualFixedContext,
} = require('./annualFixedChargeService');
const { calculateTotals } = require('./billingCalculator');
const {
    calculateReadingById,
    getArticlesByCode,
    summarizeBillablePreviews,
} = require('./calcoloLettura');
const { avvisiDellaLettura, fatturataDopo, motivoLetturaSuperata } = require('./avvisiLettura');
const { descriviMora, fatturePrecedenti, rigaMoraPer } = require('./mora');
const { notFound } = require('../utils/errors');
const { sumMoneyBy } = require('../utils/values');

const DA_FATTURARE = { $or: [{ fatturata: false }, { fatturata: { $exists: false } }] };
const LIMITE_MASSIMO = 2000;

const perId = (record) => String(record?._id || record || '');

// Tutte le letture dei contatori coinvolti, dalla piu vecchia: e la storia su
// cui si misurano gli avvisi. Una lettura sola per tutta l'anteprima.
const storiaDeiContatori = async (contatoreIds) => {
    const letture = await Lettura.find({ contatore: { $in: contatoreIds } })
        .select('contatore data_lettura consumo fatturata')
        .sort({ data_lettura: 1, _id: 1 })
        .lean();
    const storia = new Map();

    letture.forEach((lettura) => {
        const chiave = perId(lettura.contatore);
        storia.set(chiave, [...(storia.get(chiave) || []), lettura]);
    });

    return storia;
};

const sommaTotali = (a, b) => ({
    ...a,
    imponibile: sumMoneyBy([a, b], (totali) => totali.imponibile),
    iva: sumMoneyBy([a, b], (totali) => totali.iva),
    totale_fattura: sumMoneyBy([a, b], (totali) => totali.totale_fattura),
});

// Un gruppo pronto: gli importi delle letture, piu la mora se la fattura la
// porterebbe. La mora c'e solo se c'e una fattura, cioe almeno una lettura da
// fatturare. Si calcola anche quando la si lascia fuori, per dire quanto vale:
// entra nel totale solo se inclusa.
const chiudiGruppo = (gruppo, { articlesByCode, includeDelay, oggi, precedenti }) => {
    let totals = summarizeBillablePreviews(gruppo.previews);
    let mora = null;

    if (totals.letture > 0) {
        const precedente = precedenti.get(perId(gruppo.cliente));

        try {
            const riga = rigaMoraPer({ articlesByCode, precedente, dataFattura: oggi });
            if (riga) {
                mora = { ...descriviMora(precedente, oggi), inclusa: includeDelay, totals: calculateTotals([riga]) };
                totals = includeDelay ? sommaTotali(totals, mora.totals) : totals;
            }
        } catch (error) {
            gruppo.anomalies.push({ message: error.message });
        }
    }

    return {
        ...gruppo,
        mora,
        totals,
        daVerificare: gruppo.previews.some((preview) => preview.avvisi?.length > 0),
    };
};

// Il calcolo di letture gia caricate (con contatore, listino e cliente), diviso
// per cliente.
const calcolaGruppi = async (letture, {
    annualFixedLookupCache,
    includeDelay = true,
    includeFixedCharge = true,
} = {}) => {
    const oggi = new Date();
    const clienteIds = [...new Set(letture.map((lettura) => perId(lettura.contatore?.cliente)).filter(Boolean))];
    const contatoreIds = [...new Set(letture.map((lettura) => perId(lettura.contatore)).filter(Boolean))];
    const articlesByCode = await getArticlesByCode();
    const storia = await storiaDeiContatori(contatoreIds);
    const precedenti = await fatturePrecedenti(clienteIds, oggi);
    const billingContext = createAnnualFixedContext({ annualFixedLookupCache });
    const gruppi = new Map();
    const anomalieGenerali = [];

    for (const lettura of letture) {
        const cliente = lettura.contatore?.cliente;

        if (!cliente?._id) {
            anomalieGenerali.push({
                lettura: lettura._id,
                message: 'Lettura senza cliente collegato al contatore',
            });
            continue;
        }

        if (!gruppi.has(perId(cliente))) {
            gruppi.set(perId(cliente), { cliente, previews: [], anomalies: [] });
        }
        const gruppo = gruppi.get(perId(cliente));
        const storiaContatore = storia.get(perId(lettura.contatore)) || [];
        const successiva = fatturataDopo(lettura, storiaContatore);

        if (successiva) {
            gruppo.anomalies.push({
                lettura,
                contatore: lettura.contatore,
                message: motivoLetturaSuperata(lettura, successiva),
            });
            continue;
        }

        try {
            const preview = await calculateReadingById(lettura._id, {
                ...billingContext,
                articlesByCode,
                includeFixedCharge,
            });
            gruppo.previews.push({
                ...preview,
                avvisi: avvisiDellaLettura({
                    lettura,
                    consumo: preview.billableConsumption,
                    storia: storiaContatore,
                    oggi,
                }),
            });
        } catch (error) {
            gruppo.anomalies.push({
                lettura,
                contatore: lettura.contatore,
                message: error.message,
            });
        }
    }

    return {
        clienti: [...gruppi.values()].map((gruppo) => chiudiGruppo(gruppo, {
            articlesByCode,
            includeDelay: includeDelay !== false,
            oggi,
            precedenti,
        })),
        anomalies: anomalieGenerali,
    };
};

const POPOLA_CONTATORE = { path: 'contatore', populate: ['cliente', 'listino'] };

const previewClienteBilling = async (clienteId, options = {}) => {
    const cliente = await Cliente.findById(clienteId).lean().orFail(() => notFound('Cliente non trovato.'));
    const contatori = await Contatore.find({ cliente: clienteId }).populate('listino cliente').lean();
    const letture = await Lettura.find({
        contatore: { $in: contatori.map((contatore) => contatore._id) },
        ...DA_FATTURARE,
    })
        .sort({ data_lettura: 1, _id: 1 })
        .populate(POPOLA_CONTATORE)
        .lean();
    // Per un solo cliente non si precarica l'intera cache delle quote fisse
    // annuali: l'aggregazione completa costerebbe piu di quanto faccia
    // risparmiare, e la cache incrementale per contatore/anno basta.
    const { clienti, anomalies } = await calcolaGruppi(letture, options);
    const gruppo = clienti[0] || { previews: [], anomalies: [], mora: null, daVerificare: false };

    return {
        cliente,
        contatori,
        previews: gruppo.previews,
        anomalies: [...anomalies, ...gruppo.anomalies],
        mora: gruppo.mora,
        daVerificare: gruppo.daVerificare,
        totals: gruppo.totals || summarizeBillablePreviews([]),
    };
};

// Quali clienti entrano nell'anteprima: tutte le loro letture da fatturare, in
// ordine di lettura, finche non si arriva al limite. Un cliente non si spezza
// mai: le sue letture escluse finirebbero in una seconda fattura.
const scegliLetture = async (limite) => {
    const daFatturare = await Lettura.find(DA_FATTURARE)
        .select('_id contatore')
        .sort({ data_lettura: 1, _id: 1 })
        .lean();
    const contatori = await Contatore.find({ _id: { $in: daFatturare.map((lettura) => lettura.contatore) } })
        .select('cliente')
        .lean();
    const clienteDelContatore = new Map(contatori.map((contatore) => [perId(contatore), perId(contatore.cliente)]));
    const perCliente = new Map();

    daFatturare.forEach((lettura) => {
        // Le letture senza cliente contano ciascuna per se: l'anteprima le
        // mostra come anomalie.
        const chiave = clienteDelContatore.get(perId(lettura.contatore)) || `senza-cliente-${lettura._id}`;
        perCliente.set(chiave, [...(perCliente.get(chiave) || []), lettura._id]);
    });

    const scelte = [];
    let clientiInclusi = 0;
    for (const ids of perCliente.values()) {
        if (clientiInclusi > 0 && scelte.length + ids.length > limite) {
            break;
        }
        scelte.push(...ids);
        clientiInclusi += 1;
    }

    return {
        ids: scelte,
        clientiEsclusi: perCliente.size - clientiInclusi,
        lettureEscluse: daFatturare.length - scelte.length,
    };
};

const previewBillingBatch = async ({ includeDelay = true, includeFixedCharge = true, limit = LIMITE_MASSIMO } = {}) => {
    const limite = Math.min(Math.max(Number.parseInt(limit, 10) || LIMITE_MASSIMO, 1), LIMITE_MASSIMO);
    const { ids, clientiEsclusi, lettureEscluse } = await scegliLetture(limite);
    const letture = await Lettura.find({ _id: { $in: ids } })
        .sort({ data_lettura: 1, _id: 1 })
        .populate(POPOLA_CONTATORE)
        .lean();
    const { clienti, anomalies } = await calcolaGruppi(letture, {
        annualFixedLookupCache: await buildAnnualFixedLookupCache(),
        includeDelay,
        includeFixedCharge,
    });
    const pronti = clienti.filter((gruppo) => gruppo.totals.letture > 0);
    const conMora = pronti.filter((gruppo) => gruppo.mora);

    return {
        limit: limite,
        scannedReadings: letture.length,
        hasMore: clientiEsclusi > 0,
        clientiEsclusi,
        lettureEscluse,
        clienti,
        anomalies,
        totals: {
            clienti: pronti.length,
            letture: pronti.reduce((total, gruppo) => total + gruppo.totals.letture, 0),
            imponibile: sumMoneyBy(pronti, (gruppo) => gruppo.totals.imponibile),
            iva: sumMoneyBy(pronti, (gruppo) => gruppo.totals.iva),
            totale_fattura: sumMoneyBy(pronti, (gruppo) => gruppo.totals.totale_fattura),
            anomalie: anomalies.length + clienti.reduce((total, gruppo) => total + gruppo.anomalies.length, 0),
            daVerificare: pronti.filter((gruppo) => gruppo.daVerificare).length,
            mora: {
                inclusa: includeDelay !== false,
                clienti: conMora.length,
                importo: sumMoneyBy(conMora, (gruppo) => gruppo.mora.totals.totale_fattura),
            },
        },
    };
};

module.exports = {
    previewBillingBatch,
    previewClienteBilling,
};
