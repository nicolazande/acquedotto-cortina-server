// Il riparto condominiale, come lo faceva il gestionale precedente.
//
// In un edificio con un contatore condominiale ("Condominali Ripartiti") il
// consumo comune si divide fra le utenze private dello stesso edificio, secondo
// la quota scritta su ciascuna: alla Casa ex Lete 33,34 / 33,33 / 33,33. Il
// contatore condominiale non si fattura da solo. Ogni utenza paga il suo
// contatore e, accanto, la sua parte del condominiale - il consumo del periodo e
// la quota fissa - con il listino del condominiale e gli articoli COND e CONDF:
//
//   Spesa Acqua cont. condominiale. Su Seriale:07496473 Perc. 33,33   mc 14,3319
//   Spesa Acqua cont. condominiale. Su Seriale:07496473 Perc. 33,33   mc  0,3333
//
// Prima queste letture si fermavano con un errore e il riparto si faceva a mano.

const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const Servizio = require('../models/Servizio');
const {
    calculateReadingInvoice,
    calculateTotals,
    isSplitCondominiumCounter,
    numberOrZero,
    quotaDiRiparto,
    roundMoney,
} = require('./billingCalculator');
const {
    CON_CONTATORE,
    fasceDelListino,
    getArticlesByCode,
    getPreviousReading,
} = require('./calcoloLettura');
const { getDate } = require('../utils/dates');
const { recordId, withSession } = require('../utils/mongo');
const { hasValue } = require('../utils/values');

// I metri cubi in quota restano con quattro decimali, come li scriveva Gesco.
const quattroDecimali = (valore) => Math.round(valore * 10000) / 10000;

// Una riga del condominiale ridotta alla quota dell'utenza. Il consumo si
// riduce e si moltiplica per il prezzo; la quota fissa si riduce e basta.
const rigaInQuota = (riga, { quota, utenza }) => {
    const parte = quota / 100;
    const metriCubi = quattroDecimali(numberOrZero(riga.metri_cubi) * parte);
    const valore = riga.tipo_quota
        ? roundMoney(numberOrZero(riga.valore_unitario) * parte)
        : roundMoney(metriCubi * numberOrZero(riga.prezzo));

    return {
        ...riga,
        descrizione: `Spesa Acqua cont. condominiale. Su Seriale:${utenza.seriale || ''} Perc. ${String(quota).replace('.', ',')}`,
        metri_cubi: metriCubi,
        valore_unitario: valore,
        calcolo_snapshot: {
            ...riga.calcolo_snapshot,
            totale_riga: valore,
            riparto: { contatore: recordId(utenza), seriale: utenza.seriale, quota },
        },
    };
};

// La parte di una lettura del condominiale che spetta a un'utenza, con o senza
// la quota fissa. `previousValue` e `currentValue` servono alla verifica di una
// fattura gia emessa, che rifa il conto con gli indici scritti sulle sue righe.
const calcolaQuota = async ({
    articlesByCode,
    conQuotaFissa,
    currentValue,
    fascePerListino,
    lettura,
    previousValue,
    quota,
    session,
    utenza,
}) => {
    const precedente = await getPreviousReading(lettura, session);
    const fasce = await fasceDelListino(lettura.contatore.listino._id, { fascePerListino, session });
    const calcolo = calculateReadingInvoice({
        articlesByCode: articlesByCode || await getArticlesByCode(session),
        contatore: lettura.contatore,
        currentValue: hasValue(currentValue) ? currentValue : lettura.consumo,
        fasce,
        includeFixedCharge: conQuotaFissa,
        lettura,
        previousValue: hasValue(previousValue) ? previousValue : precedente?.consumo || 0,
    });
    const lines = calcolo.lines.map((riga) => rigaInQuota(riga, { quota, utenza }));

    return {
        ...calcolo,
        lettura,
        contatore: lettura.contatore,
        previousReading: precedente,
        linkedInvoices: [],
        riparto: {
            contatore: recordId(utenza),
            seriale: utenza.seriale,
            quota,
            consumoTotale: calcolo.billableConsumption,
        },
        billableConsumption: quattroDecimali(calcolo.billableConsumption * quota / 100),
        lines,
        totals: calculateTotals(lines),
    };
};

// Il contatore condominiale dell'edificio di un'utenza, se c'e.
const condominialeDi = async (utenza, session) => {
    if (!utenza?.edificio) {
        return null;
    }

    const contatori = await withSession(Contatore.find({
        edificio: recordId(utenza.edificio),
        _id: { $ne: utenza._id },
    }), session).lean();
    return contatori.find(isSplitCondominiumCounter) || null;
};

// Le parti del condominiale che un cliente deve ancora pagare, per ciascuna delle
// sue utenze con una quota: le letture del condominiale dopo l'inizio
// dell'utenza e fino alla data della fattura, che nessuna sua fattura porta
// ancora e che sono da ripartire - non ancora fatturate a nessuno, oppure gia
// in fattura a un'altra utenza. Una lettura segnata fatturata che nessuna
// fattura porta e quella da cui si e cominciato a contare: non e un consumo, e
// ripartirla farebbe pagare l'intero indice. La quota fissa condominiale una
// volta l'anno, sull'ultima lettura.
const quoteCondominiali = async ({
    articlesByCode,
    cliente,
    contatori,
    dataFattura,
    fascePerListino,
    session,
}) => {
    const utenze = contatori.filter((contatore) => quotaDiRiparto(contatore) > 0);
    if (utenze.length === 0) {
        return [];
    }

    const data = getDate(dataFattura);
    const fatture = await withSession(Fattura.find({ cliente: recordId(cliente) }), session).select('_id anno').lean();
    const suoFatture = fatture.map((fattura) => fattura._id);
    const dellAnno = fatture.filter((fattura) => fattura.anno === data.getUTCFullYear()).map((fattura) => fattura._id);
    const quote = [];

    for (const utenza of utenze) {
        const condominiale = await condominialeDi(utenza, session);
        if (!condominiale) {
            continue;
        }

        const letture = await withSession(Lettura.find({
            contatore: condominiale._id,
            data_lettura: { $lte: data, ...(utenza.inizio ? { $gt: new Date(utenza.inizio) } : {}) },
        }), session).sort({ data_lettura: 1, _id: 1 }).populate(CON_CONTATORE).lean();
        const ids = letture.map((lettura) => lettura._id);
        const righe = await withSession(Servizio.find({ lettura: { $in: ids } }), session)
            .select('lettura fattura')
            .lean();
        const inFattura = new Set(righe.map((riga) => String(riga.lettura)));
        const suoFattureIds = new Set(suoFatture.map(String));
        const giaPagate = new Set(righe
            .filter((riga) => suoFattureIds.has(String(riga.fattura)))
            .map((riga) => String(riga.lettura)));
        const daPagare = letture.filter((lettura) => (
            !giaPagate.has(String(lettura._id))
            && (!lettura.fatturata || inFattura.has(String(lettura._id)))
        ));
        if (daPagare.length === 0) {
            continue;
        }

        const fissoPagato = await withSession(Servizio.exists({
            lettura: { $in: ids },
            fattura: { $in: dellAnno },
            tipo_quota: { $nin: [null, ''] },
        }), session);

        for (const [indice, lettura] of daPagare.entries()) {
            quote.push(await calcolaQuota({
                articlesByCode,
                conQuotaFissa: !fissoPagato && indice === daPagare.length - 1,
                fascePerListino,
                lettura,
                quota: quotaDiRiparto(utenza),
                session,
                utenza,
            }));
        }
    }

    return quote;
};

// Nella verifica di una fattura gia emessa: le righe di una lettura del
// condominiale (gia caricata) sono la parte di un'utenza del cliente della
// fattura. Si rifa il conto in quota, con la quota fissa se la fattura la porta.
// Restituisce null se la lettura non e del condominiale.
const verificaQuota = async ({ fattura, lettura, righe, session, ...memoria }) => {
    if (!isSplitCondominiumCounter(lettura?.contatore)) {
        return null;
    }

    const utenze = await withSession(Contatore.find({
        cliente: recordId(fattura.cliente),
        edificio: recordId(lettura.contatore.edificio),
    }), session).lean();
    const utenza = utenze.find((contatore) => quotaDiRiparto(contatore) > 0);
    if (!utenza) {
        return null;
    }

    const [prima = {}] = righe;
    return calcolaQuota({
        ...memoria,
        conQuotaFissa: righe.some((riga) => riga.tipo_quota),
        currentValue: prima.lettura_fatturazione,
        lettura,
        previousValue: prima.lettura_precedente,
        quota: quotaDiRiparto(utenza),
        session,
        utenza,
    });
};

module.exports = {
    quoteCondominiali,
    rigaInQuota,
    verificaQuota,
};
