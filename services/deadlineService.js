const Scadenza = require('../models/Scadenza');

const DEFAULT_DUE_DAYS = Number.parseInt(process.env.INVOICE_DUE_DAYS || '30', 10);

const numberOrZero = (value) => {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
};

const toDate = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (value) => {
    const date = toDate(value);
    if (!date) {
        return null;
    }

    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const addDays = (value, days) => {
    const date = startOfDay(value) || startOfDay(new Date());
    date.setUTCDate(date.getUTCDate() + days);
    return date;
};

const daysBetween = (from, to) => Math.floor((startOfDay(to) - startOfDay(from)) / 86400000);

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
    cognome: cliente?.cognome || cliente?.ragione_sociale || fattura?.ragione_sociale || fattura?.nome_cliente || '',
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

module.exports = {
    buildDeadlinePayload,
    calculateDelay,
    createDeadlineForInvoice,
    ensureInvoiceDeadline,
    getDueDate,
    withComputedDelay,
};
