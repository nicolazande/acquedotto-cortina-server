const Scadenza = require('../models/Scadenza');
const { numberOrZero } = require('../utils/values');
const { addDays, daysBetween, startOfDay, toDate } = require('../utils/dates');
const { customerLabel } = require('../utils/customer');

const DEFAULT_DUE_DAYS = Number.parseInt(process.env.INVOICE_DUE_DAYS || '30', 10);

// Il momento di riferimento del calcolo. Accetta solo una data vera: passando
// queste funzioni direttamente a .map() il secondo argomento sarebbe l'indice
// dell'array, che verrebbe letto come una data del 1970 e azzererebbe ogni
// ritardo. Meglio ignorare un valore che non e una data che restituire un
// risultato sbagliato senza dirlo.
const momentoDiRiferimento = (valore) => {
    if (valore === undefined || valore === null) {
        return new Date();
    }

    // Un numero non e mai una data di riferimento legittima: e l'indice passato
    // da .map(). Accettarlo significherebbe leggere l'indice 1 come il 1 gennaio
    // 1970 e azzerare il ritardo, che e esattamente il difetto da cui nasce
    // questo controllo.
    if (typeof valore === 'number') {
        return new Date();
    }

    return toDate(valore) || new Date();
};

const calculateDelay = (deadline, now) => {
    const dueDate = startOfDay(deadline?.scadenza);
    if (!dueDate) {
        return 0;
    }

    const adesso = momentoDiRiferimento(now);
    const referenceDate = deadline?.saldo && deadline?.pagamento
        ? startOfDay(deadline.pagamento)
        : startOfDay(adesso);

    return Math.max(0, daysBetween(dueDate, referenceDate));
};

const toPlainObject = (record) => (
    record && typeof record.toObject === 'function' ? record.toObject() : { ...(record || {}) }
);

const withComputedDelay = (deadline, now) => {
    const plain = toPlainObject(deadline);
    return {
        ...plain,
        ritardo: calculateDelay(plain, now),
    };
};

const getDueDate = (invoiceDate, dueDate) => (
    startOfDay(dueDate) || addDays(invoiceDate || new Date(), Number.isFinite(DEFAULT_DUE_DAYS) ? DEFAULT_DUE_DAYS : 30)
);

const getCustomerNameParts = (cliente, fattura) => ({
    cognome: cliente?.cognome || customerLabel(cliente, fattura),
    nome: cliente?.nome || '',
});

const buildDeadlinePayload = ({ cliente, dueDate, fattura }) => {
    const nameParts = getCustomerNameParts(cliente, fattura);
    const payload = {
        scadenza: getDueDate(fattura?.data_fattura, dueDate),
        saldo: false,
        pagamento: null,
        anno: fattura?.anno,
        numero: fattura?.numero,
        cognome: nameParts.cognome,
        nome: nameParts.nome,
        totale: numberOrZero(fattura?.totale_fattura),
        solleciti: 0,
    };

    return withComputedDelay(payload);
};

const createDeadlineForInvoice = async ({ cliente, dueDate, fattura, session }) => {
    const payload = buildDeadlinePayload({ cliente, dueDate, fattura });
    const [deadline] = await Scadenza.create([payload], { session });
    return deadline;
};

const ensureInvoiceDeadline = async ({ cliente, dueDate, fattura, session }) => {
    if (fattura.scadenza) {
        return Scadenza.findById(fattura.scadenza).session(session || null);
    }

    const deadline = await createDeadlineForInvoice({ cliente, dueDate, fattura, session });
    fattura.scadenza = deadline._id;
    await fattura.save({ session });

    return deadline;
};

const syncInvoiceDeadlineTotal = async ({ fattura, session }) => {
    if (!fattura?.scadenza) {
        return null;
    }

    const deadlineId = fattura.scadenza?._id || fattura.scadenza;
    return Scadenza.findByIdAndUpdate(
        deadlineId,
        { $set: { totale: numberOrZero(fattura.totale_fattura) } },
        { new: true, session }
    );
};

// Stato di una scadenza. Definito qui una volta sola: prima la stessa condizione
// era riscritta in tre punti (viste delle liste, panoramica, ordinamento) con tre
// espressioni diverse, che potevano divergere senza che nulla lo segnalasse.
// Il campo puo mancare sui record piu vecchi: assente significa non saldata.
const SALDATA = { saldo: true };
const NON_SALDATA = { $or: [{ saldo: false }, { saldo: { $exists: false } }] };

// La stessa condizione per le pipeline di aggregazione.
const saldataExpression = () => ({ $eq: [{ $ifNull: ['$saldo', false] }, true] });

// Stessa formula di calculateDelay, ma valutata da MongoDB: serve per ordinare
// la lista scadenze sul ritardo reale invece che sul valore salvato, che invecchia
// di un giorno al giorno.
const delayAggregation = () => ({
    $cond: [
        { $ifNull: ['$scadenza', false] },
        {
            $max: [
                0,
                {
                    $dateDiff: {
                        startDate: { $dateTrunc: { date: '$scadenza', unit: 'day' } },
                        endDate: {
                            $dateTrunc: {
                                date: {
                                    $cond: [
                                        {
                                            $and: [
                                                saldataExpression(),
                                                { $ne: [{ $ifNull: ['$pagamento', null] }, null] },
                                            ],
                                        },
                                        '$pagamento',
                                        '$$NOW',
                                    ],
                                },
                                unit: 'day',
                            },
                        },
                        unit: 'day',
                    },
                },
            ],
        },
        0,
    ],
});

module.exports = {
    NON_SALDATA,
    SALDATA,
    buildDeadlinePayload,
    delayAggregation,
    saldataExpression,
    calculateDelay,
    ensureInvoiceDeadline,
    getDueDate,
    syncInvoiceDeadlineTotal,
    withComputedDelay,
};
