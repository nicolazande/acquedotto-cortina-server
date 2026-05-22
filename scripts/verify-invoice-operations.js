require('dotenv').config();

const assert = require('assert');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const AuditLog = require('../models/AuditLog');
const Cliente = require('../models/Cliente');
const Fattura = require('../models/Fattura');
const Servizio = require('../models/Servizio');
const FatturaController = require('../controllers/FatturaController');
const ServizioController = require('../controllers/ServizioController');

const callController = (handler, { body = {}, params = {}, query = {} } = {}) => new Promise((resolve) => {
    const res = {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            resolve({ body: payload, status: this.statusCode });
        },
    };

    handler({ body, params, query, user: { username: 'verify-script', role: 'admin' } }, res);
});

const withSilencedErrors = async (action) => {
    const originalError = console.error;
    console.error = () => {};

    try {
        return await action();
    } finally {
        console.error = originalError;
    }
};

const main = async () => {
    await connectDB();

    const suffix = Date.now();
    const cliente = await Cliente.create({
        cognome: 'Operazioni',
        nome: `Fatture ${suffix}`,
        codice_cliente_erp: `OPS-${suffix}`,
    });
    const draft = await Fattura.create({
        anno: 2026,
        cliente: cliente._id,
        confermata: false,
        data_fattura: new Date('2026-05-22'),
        imponibile: 10,
        iva: 1,
        numero: suffix % 100000,
        ragione_sociale: 'Verifica operazioni',
        stato: 'bozza',
        tipo_documento: 'Fattura',
        totale_fattura: 11,
    });
    const confirmed = await Fattura.create({
        anno: 2026,
        cliente: cliente._id,
        confermata: true,
        data_fattura: new Date('2026-05-22'),
        imponibile: 20,
        iva: 2,
        numero: (suffix % 100000) + 1,
        ragione_sociale: 'Verifica confermata',
        stato: 'confermata',
        tipo_documento: 'Fattura',
        totale_fattura: 22,
    });
    const servizio = await Servizio.create({
        descrizione: 'Verifica blocco',
        fattura: confirmed._id,
        prezzo: 1,
        valore_unitario: 1,
    });

    try {
        const updatedDraft = await callController(FatturaController.updateFattura, {
            body: { imponibile: 12, iva: 1.2, totale_fattura: 13.2 },
            params: { id: draft._id },
        });
        assert.strictEqual(updatedDraft.status, 200);
        assert.strictEqual(updatedDraft.body.imponibile, 12);

        const blockedInvoice = await withSilencedErrors(() => callController(FatturaController.updateFattura, {
            body: { imponibile: 25 },
            params: { id: confirmed._id },
        }));
        assert.strictEqual(blockedInvoice.status, 409);

        const blockedService = await withSilencedErrors(() => callController(ServizioController.updateServizio, {
            body: { valore_unitario: 9 },
            params: { id: servizio._id },
        }));
        assert.strictEqual(blockedService.status, 409);

        const controls = await callController(FatturaController.getControlDashboard, {
            query: { year: '2026', limit: '5' },
        });
        assert.strictEqual(controls.status, 200);
        assert(Number.isInteger(controls.body.summary.controllate));

        const auditCount = await AuditLog.countDocuments({ entityType: 'Fattura', entityId: draft._id });
        assert(auditCount > 0, 'invoice update should create audit log');

        console.log('Verifica operazioni fatture completata.');
    } finally {
        await AuditLog.deleteMany({ entityType: 'Fattura', entityId: { $in: [draft._id, confirmed._id] } });
        await Servizio.deleteMany({ _id: servizio._id });
        await Fattura.deleteMany({ _id: { $in: [draft._id, confirmed._id] } });
        await Cliente.deleteOne({ _id: cliente._id });
        await mongoose.disconnect();
    }
};

main().catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
});
