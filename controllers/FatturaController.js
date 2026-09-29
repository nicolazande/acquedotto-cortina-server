const Fattura = require('../models/Fattura');
const Cliente = require('../models/Cliente');
const Servizio = require('../models/Servizio');
const { righeDellaFattura } = require('../services/righeFattura');
const Scadenza = require('../models/Scadenza');
const { sendPaginated } = require('./utils/paginatedQuery');
const {
    associateRecords,
    getManyByField,
    getPopulatedRelation,
    getRecord,
    rifiutaFatturaConfermata,
    sendServiceError,
} = require('./utils/controllerActions');
const { invoiceGenerationOptions, parseOptionalBoolean } = require('./utils/requestOptions');
const { confermaFattura, confermaFatture } = require('../services/confermaFatture');
const {
    createManualInvoice,
    createInvoiceFromReadings,
} = require('../services/invoiceGenerator');
const {
    applyFixedChargeToInvoice,
    verifyInvoiceCalculation,
} = require('../services/verificaFattura');
const { previewBillingBatch } = require('../services/anteprimaFatturazione');
const {
    assertInvoiceEditable,
    assertInvoiceEditableById,
    unlockOptions,
} = require('../services/invoiceLockService');
const { getAuditLogs } = require('../services/auditLogService');
const {
    invoiceLabel,
    writeInvoiceAudit,
    writeInvoiceUpdateAudit,
} = require('../services/invoiceAuditService');
const {
    spostaScadenzaConLaFattura,
    withComputedDelay,
    withDeadlineDelay,
} = require('../services/deadlineService');
const { verificaDataNumerata } = require('../services/numerazioneFatture');
const { getInvoiceControlDashboard } = require('../services/invoiceControlService');
const { deleteInvoice } = require('../services/invoiceDeletionService');
const { generateInvoicePdf } = require('../services/invoicePdf');
const { buildInvoiceXml } = require('../services/invoiceXml');
const { fatturaViews } = require('../config/listViews');
const { haNumero, isConfirmedInvoice } = require('../config/invoicing');
const { startOfDay } = require('../utils/dates');
const { badRequest, notFound, unprocessable } = require('../utils/errors');

const invoiceStatus = (confermata) => (parseOptionalBoolean(confermata) ? 'confermata' : 'bozza');

// Numero, serie e codice li assegna la conferma, l'anno segue la data: la
// maschera rispedisce il record intero, e da li non si riscrivono.
const CAMPI_DELLA_NUMERAZIONE = ['anno', 'numero', 'serie', 'codice'];

const normalizeInvoicePayload = (body = {}) => {
    const payload = { ...body };
    CAMPI_DELLA_NUMERAZIONE.forEach((campo) => delete payload[campo]);
    delete payload.sbloccoConfermato;

    // La spunta "Confermata" decide. La maschera rispedisce l'intero record,
    // quindi insieme alla spunta arriva anche lo stato di prima: tenerlo
    // significava confermare una fattura che restava fra le bozze.
    // Chi manda solo lo stato dice la stessa cosa con l'altro campo: senza
    // tradurlo, la fattura passava a confermata senza passare dalla conferma, e
    // quindi senza numero.
    if (payload.confermata !== undefined) {
        payload.confermata = parseOptionalBoolean(payload.confermata);
        payload.stato = invoiceStatus(payload.confermata);
    } else if (payload.stato !== undefined) {
        payload.confermata = /^confermata$/i.test(String(payload.stato));
        payload.stato = invoiceStatus(payload.confermata);
    }

    return payload;
};

// La data di una fattura che cambia. Su una bozza senza numero l'anno la segue;
// una fattura numerata resta nel suo anno e fra i numeri vicini
// (services/numerazioneFatture.js). Restituisce se la data e cambiata davvero:
// la maschera rispedisce anche quella di prima.
const cambioDiData = async (fattura, payload) => {
    const nuova = startOfDay(payload.data_fattura);
    if (!nuova || nuova.getTime() === startOfDay(fattura.data_fattura)?.getTime()) {
        return false;
    }

    if (haNumero(fattura)) {
        await verificaDataNumerata({ fattura, data_fattura: nuova });
    } else {
        payload.anno = nuova.getUTCFullYear();
    }

    return true;
};

const withEditableInvoice = (handler, idParam, action) => async (req, res) => {
    try {
        await assertInvoiceEditableById(req.params[idParam], action, unlockOptions(req));
        return handler(req, res);
    } catch (error) {
        return rifiutaFatturaConfermata(res, error);
    }
};

const createFattura = async (req, res) => {
    try {
        const result = await createManualInvoice(req.body);
        const confermata = isConfirmedInvoice(result.fattura);
        await writeInvoiceAudit(
            req,
            result.fattura,
            confermata ? 'fattura.confermata' : 'fattura.creata',
            `${confermata ? 'Creata e confermata' : 'Creata'} ${invoiceLabel(result.fattura)}`
        );
        res.status(201).json(result.fattura);
    } catch (error) {
        sendServiceError(res, error, 'Creazione della fattura non riuscita.', 400);
    }
};

const getFatture = (req, res) => sendPaginated(Fattura, req, res, {
    views: fatturaViews,
    defaultSort: 'data_fattura',
    errorMessage: 'Elenco delle fatture non disponibile.',
    populate: 'cliente scadenza',
});

const generateFromReadings = async (req, res) => {
    try {
        const result = await createInvoiceFromReadings({
            letture: req.body.letture || req.body.letturaIds,
            ...invoiceGenerationOptions(req.body),
        });

        await writeInvoiceAudit(req, result.fattura, 'fattura.generata', `Generata ${invoiceLabel(result.fattura)}`, {
            metadata: {
                letture: result.calculations?.length || 0,
            },
        });
        res.status(201).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Generazione della fattura non riuscita.', 400);
    }
};

const getGenerationPreview = async (req, res) => {
    try {
        const result = await previewBillingBatch({
            includeDelay: parseOptionalBoolean(req.query.includeDelay),
            includeFixedCharge: parseOptionalBoolean(req.query.includeFixedCharge),
            limit: req.query.limit,
        });
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Anteprima della fatturazione non disponibile.');
    }
};

const getControlDashboard = async (req, res) => {
    try {
        const result = await getInvoiceControlDashboard({
            stato: req.query.stato,
            year: req.query.year,
        });
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Controlli delle fatture non disponibili.');
    }
};

const verifyCalcolo = async (req, res) => {
    try {
        const result = await verifyInvoiceCalculation(req.params.id);
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Verifica del calcolo non riuscita.');
    }
};

const fatturaNonTrovata = () => notFound('Fattura non trovata.');

const applyFixedCharge = async (req, res) => {
    try {
        const before = await Fattura.findById(req.params.id).orFail(fatturaNonTrovata).lean();
        assertInvoiceEditable(before, 'aggiungere la quota fissa', unlockOptions(req));

        const result = await applyFixedChargeToInvoice(req.params.id, unlockOptions(req));
        await writeInvoiceAudit(req, before, 'fattura.quota_fissa', 'Aggiunta quota fissa', {
            metadata: {
                serviziCreati: result.servizi?.length || 0,
                totals: result.totals,
            },
        });
        res.status(200).json(result);
    } catch (error) {
        sendServiceError(res, error, 'Quota fissa non aggiunta.', 400);
    }
};

// Fattura elettronica in formato XML. La trasmissione allo SdI resta fuori: il
// file e identico in ogni scenario di invio, cambia solo chi lo inoltra.
const downloadXml = async (req, res) => {
    try {
        // La scadenza entra nel tracciato: dice al cliente entro quando pagare.
        const fattura = await Fattura.findById(req.params.id).populate('cliente scadenza').orFail(fatturaNonTrovata).lean();
        if (!isConfirmedInvoice(fattura)) {
            throw unprocessable('La fattura è una bozza: il file XML si prepara dopo la conferma.');
        }

        const servizi = await righeDellaFattura(fattura._id);

        const { filename, xml } = buildInvoiceXml({
            cliente: fattura.cliente,
            fattura,
            scadenza: fattura.scadenza,
            servizi,
        });

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.status(200).send(xml);
    } catch (error) {
        return sendServiceError(res, error, 'File XML della fattura non generato.');
    }
};

const downloadPdf = async (req, res) => {
    try {
        const { buffer, filename } = await generateInvoicePdf(req.params.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        res.status(200).send(buffer);
    } catch (error) {
        sendServiceError(res, error, 'PDF della fattura non generato.');
    }
};

const updateFattura = async (req, res) => {
    try {
        const before = await Fattura.findById(req.params.id).orFail(fatturaNonTrovata).lean();
        // Modificare un documento gia emesso e possibile solo con conferma esplicita,
        // e resta registrato come tale: e la differenza fra una correzione
        // consapevole e una modifica silenziosa allo storico.
        const suDocumentoEmesso = assertInvoiceEditable(before, 'modificare la fattura', unlockOptions(req));

        const payload = normalizeInvoicePayload(req.body);
        const dataCambiata = await cambioDiData(before, payload);

        // Confermare una bozza le da il numero: passa dalla conferma, l'unico
        // punto in cui un numero si assegna.
        const conferma = payload.confermata === true && !isConfirmedInvoice(before);
        const after = conferma
            ? await confermaFattura(req.params.id, payload)
            : await Fattura.findByIdAndUpdate(req.params.id, payload, { new: true }).lean();
        // La scadenza di una bozza segue la sua data: e cio che si fa quando la
        // conferma rifiuta una data piu vecchia dell'ultima fattura numerata.
        if (dataCambiata && !isConfirmedInvoice(before)) {
            await spostaScadenzaConLaFattura({ fattura: before, nuovaData: payload.data_fattura });
        }
        const azione = suDocumentoEmesso
            ? 'fattura.modificata_dopo_conferma'
            : (conferma ? 'fattura.confermata' : 'fattura.modificata');
        await writeInvoiceUpdateAudit(req, before, after, azione);
        return res.status(200).json(after);
    } catch (error) {
        return sendServiceError(res, error, 'Modifica della fattura non riuscita.', error.status || 400);
    }
};

// Le bozze di un giro di fatturazione, confermate insieme dai controlli. Ognuna
// riceve il suo numero; quelle che non si possono confermare restano bozze, e la
// risposta dice perche.
const confermaBozze = async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.fatture) ? req.body.fatture : [];
        if (ids.length === 0) {
            throw badRequest('Indica le bozze da confermare.');
        }

        const esito = await confermaFatture(ids);
        for (const fattura of esito.confermate) {
            await writeInvoiceAudit(req, fattura, 'fattura.confermata', `Confermata ${invoiceLabel(fattura)}`);
        }

        return res.status(200).json({
            confermate: esito.confermate.map(({ _id, codice, numero }) => ({ _id, codice, numero })),
            rifiutate: esito.rifiutate,
            saltate: esito.saltate,
        });
    } catch (error) {
        return sendServiceError(res, error, 'Conferma delle bozze non riuscita.', 400);
    }
};

const deleteFattura = async (req, res) => {
    try {
        const result = await deleteInvoice(req.params.id, unlockOptions(req));

        await writeInvoiceAudit(req, result.fattura, 'fattura.cancellata', `Cancellata ${invoiceLabel(result.fattura)}`, {
            metadata: {
                numero: result.fattura.numero,
                anno: result.fattura.anno,
                serviziCancellati: result.serviziCancellati,
                letturaSbloccate: result.letturaSbloccate,
                scadenzaCancellata: result.scadenzaCancellata,
                consegneCancellate: result.consegneCancellate || undefined,
                documentoEmesso: result.eraConfermata || undefined,
                numeroLiberato: result.numeroLiberato || undefined,
            },
        });
        return res.status(204).send();
    } catch (error) {
        return sendServiceError(res, error, 'Cancellazione della fattura non riuscita.', error.status || 400);
    }
};

const getAuditLog = async (req, res) => {
    try {
        const logs = await getAuditLogs('Fattura', req.params.id, { limit: req.query.limit });
        res.status(200).json(logs);
    } catch (error) {
        sendServiceError(res, error, 'Storia delle modifiche non disponibile.');
    }
};

const associateCliente = associateRecords({
    field: 'cliente',
    responseKey: 'fattura',
    setOn: 'source',
    sourceModel: Fattura,
    sourceName: 'Fattura',
    sourceParam: 'fatturaId',
    targetModel: Cliente,
    targetName: 'Cliente',
    targetParam: 'clienteId',
});

const associateServizio = associateRecords({
    field: 'fattura',
    responseKey: 'servizio',
    setOn: 'target',
    sourceModel: Fattura,
    sourceName: 'Fattura',
    sourceParam: 'fatturaId',
    targetModel: Servizio,
    targetName: 'Servizio',
    targetParam: 'servizioId',
});

const associateScadenza = associateRecords({
    field: 'scadenza',
    responseKey: 'scadenza',
    responseRecord: 'target',
    setOn: 'source',
    sourceModel: Fattura,
    sourceName: 'Fattura',
    sourceParam: 'fatturaId',
    targetModel: Scadenza,
    targetName: 'Scadenza',
    targetParam: 'scadenzaId',
});

module.exports = {
    createFattura,
    getFatture,
    generateFromReadings,
    getGenerationPreview,
    getControlDashboard,
    applyFixedCharge,
    // La scadenza viaggia insieme alla fattura con il suo ritardo gia calcolato:
    // aprendo una fattura la prima domanda e se e stata incassata.
    getFattura: getRecord(Fattura, {
        name: 'Fattura',
        populate: 'cliente scadenza',
        transform: withDeadlineDelay,
    }),
    verifyCalcolo,
    downloadPdf,
    downloadXml,
    updateFattura,
    confermaBozze,
    deleteFattura,
    getAuditLog,
    associateCliente: withEditableInvoice(associateCliente, 'fatturaId', 'associare il cliente'),
    associateServizio: withEditableInvoice(associateServizio, 'fatturaId', 'associare il servizio'),
    associateScadenza: withEditableInvoice(associateScadenza, 'fatturaId', 'associare la scadenza'),
    getServiziAssociati: getManyByField({
        Model: Servizio,
        field: 'fattura',
        populate: 'lettura articolo listino fascia',
        errorMessage: 'Righe della fattura non disponibili.',
    }),
    getClienteAssociato: getPopulatedRelation({ Model: Fattura, name: 'Fattura', path: 'cliente' }),
    getScadenzaAssociata: getPopulatedRelation({
        Model: Fattura,
        name: 'Fattura',
        path: 'scadenza',
        transform: withComputedDelay,
    }),
};
