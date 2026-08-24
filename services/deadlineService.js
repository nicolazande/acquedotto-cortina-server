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

// Il gestionale precedente non lasciava vuota la data di pagamento: ci scriveva
// 31/12/2099, che era il suo modo di dire "non ancora pagata". Nel nuovo modello
// quel significato lo porta gia `saldo`, quindi la sentinella non e una data ma
// un buco, e va letta come tale: comparirebbe a schermo come "Pagamento:
// 31/12/2099" e, sulle scadenze saldate, produrrebbe un ritardo di ventimila
// giorni. Il controllo e su una soglia e non sul valore esatto perche un nuovo
// import puo riportarla con un'ora diversa.
const DATA_IMPLAUSIBILE = new Date('2090-01-01T00:00:00.000Z');

const dataPagamento = (valore) => {
    const data = toDate(valore);
    return data && data < DATA_IMPLAUSIBILE ? data : null;
};

const calculateDelay = (deadline, now) => {
    const dueDate = startOfDay(deadline?.scadenza);
    if (!dueDate) {
        return 0;
    }

    // Una scadenza saldata ha smesso di accumulare ritardo: si misura fino al
    // giorno del pagamento. Se quel giorno non e noto il ritardo non e
    // calcolabile e vale zero - contarlo fino a oggi lo farebbe crescere per
    // sempre su una posizione ormai chiusa.
    if (deadline?.saldo) {
        const pagata = dataPagamento(deadline?.pagamento);
        return pagata ? Math.max(0, daysBetween(dueDate, startOfDay(pagata))) : 0;
    }

    return Math.max(0, daysBetween(dueDate, startOfDay(momentoDiRiferimento(now))));
};

const toPlainObject = (record) => (
    record && typeof record.toObject === 'function' ? record.toObject() : { ...(record || {}) }
);

const withComputedDelay = (deadline, now) => {
    const plain = toPlainObject(deadline);
    return {
        ...plain,
        // La data sentinella non esce mai da qui: e l'unico punto attraverso cui
        // le scadenze passano prima di essere lette o salvate.
        ...(plain.pagamento === undefined ? {} : { pagamento: dataPagamento(plain.pagamento) }),
        ritardo: calculateDelay(plain, now),
    };
};

// Lo stesso ritardo, calcolato sulla scadenza che un altro documento porta con
// se: la fattura la include gia fra i suoi dati, e senza questo il client
// dovrebbe rifare il conto per conto proprio, cioe riscrivere la regola.
const withDeadlineDelay = (record) => {
    if (!record) {
        return record;
    }

    const plain = toPlainObject(record);
    return plain.scadenza ? { ...plain, scadenza: withComputedDelay(plain.scadenza) } : plain;
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

// Una scadenza saldata con una data di pagamento vera, cioe non la sentinella
// del gestionale precedente.
const pagataConData = () => ({
    $and: [
        saldataExpression(),
        { $ne: [{ $ifNull: ['$pagamento', null] }, null] },
        { $lt: ['$pagamento', DATA_IMPLAUSIBILE] },
    ],
});

// Stessa formula di calculateDelay, ma valutata da MongoDB: serve per ordinare
// la lista scadenze sul ritardo reale invece che sul valore salvato, che invecchia
// di un giorno al giorno. Una scadenza saldata senza data di pagamento nota si
// misura contro la propria scadenza, cosi il ritardo resta zero invece di
// crescere ogni giorno.
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
                                        pagataConData(),
                                        '$pagamento',
                                        { $cond: [saldataExpression(), '$scadenza', '$$NOW'] },
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
    DATA_IMPLAUSIBILE,
    NON_SALDATA,
    SALDATA,
    dataPagamento,
    buildDeadlinePayload,
    delayAggregation,
    saldataExpression,
    calculateDelay,
    ensureInvoiceDeadline,
    getDueDate,
    syncInvoiceDeadlineTotal,
    withDeadlineDelay,
    withComputedDelay,
};
