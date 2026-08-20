const Scadenza = require('../models/Scadenza');
const { numberOrZero } = require('../utils/values');
const { addDays, daysBetween, startOfDay } = require('../utils/dates');
const { customerLabel } = require('../utils/customer');

const DEFAULT_DUE_DAYS = Number.parseInt(process.env.INVOICE_DUE_DAYS || '30', 10);

const calculateDelay = (deadline, now = new Date()) => {
    const dueDate = startOfDay(deadline?.scadenza);
    if (!dueDate) {
        return 0;
    }

    const referenceDate = deadline?.saldo && deadline?.pagamento
        ? startOfDay(deadline.pagamento)
        : startOfDay(now);

    return Math.max(0, daysBetween(dueDate, referenceDate));
};

const toPlainObject = (record) => (
    record && typeof record.toObject === 'function' ? record.toObject() : { ...(record || {}) }
);

const withComputedDelay = (deadline, now = new Date()) => {
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
                                                // saldo e salvato a volte come booleano e a volte come 1/0:
                                                // $toBool allinea il confronto alla verita di JavaScript.
                                                { $toBool: { $ifNull: ['$saldo', false] } },
                                                { $toBool: { $ifNull: ['$pagamento', false] } },
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
    buildDeadlinePayload,
    delayAggregation,
    calculateDelay,
    createDeadlineForInvoice,
    ensureInvoiceDeadline,
    getDueDate,
    syncInvoiceDeadlineTotal,
    withComputedDelay,
};
