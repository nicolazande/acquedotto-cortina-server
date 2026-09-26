const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const { generateInvoicePdf } = require('../services/invoicePdf');
const { FILTRO_CONFERMATE } = require('../config/invoicing');
const { customerLabel } = require('../utils/customer');
const { createError, notFound } = require('../utils/errors');
const { fromCents, sumCents } = require('../utils/money');
const { sendServiceError } = require('./utils/controllerActions');

const getCustomerId = (req) => req.user?.cliente?._id || req.user?.cliente;

const requireCustomerId = (req) => {
    const clienteId = getCustomerId(req);
    if (!clienteId) {
        throw createError('Account cliente non collegato ad alcuna anagrafica.', 403);
    }
    return clienteId;
};

// Il cliente vede solo le fatture confermate: una bozza puo ancora cambiare, o
// sparire, e non deve poterla scaricare ne trovarla nel conto da pagare.
const sueFatture = (clienteId) => ({ cliente: clienteId, ...FILTRO_CONFERMATE });

const getPortalData = async (req, res) => {
    try {
        const clienteId = requireCustomerId(req);
        const cliente = await Cliente.findById(clienteId)
            .select('ragione_sociale cognome nome codice_cliente_erp indirizzo_residenza numero_residenza localita_residenza email telefono cellulare pagamento')
            .orFail(() => notFound('Cliente non trovato.'))
            .lean();

        const contatori = await Contatore.find({ cliente: clienteId })
            .select('tipo_contatore codice nome_edificio tipo_attivita seriale seriale_interno inattivo consumo inizio scadenza')
            .sort({ inattivo: 1, nome_edificio: 1, seriale: 1 })
            .lean();
        const contatoreIds = contatori.map((contatore) => contatore._id);
        const [fatture, letture] = await Promise.all([
            Fattura.find(sueFatture(clienteId))
                .select('tipo_documento anno numero data_fattura codice imponibile iva totale_fattura stato confermata scadenza')
                .populate('scadenza', 'scadenza saldo pagamento ritardo totale')
                .sort({ data_fattura: -1, _id: -1 })
                .limit(60)
                .lean(),
            Lettura.find({ contatore: { $in: contatoreIds } })
                .select('data_lettura unita_misura consumo fatturata tipo contatore')
                .populate('contatore', 'seriale nome_edificio')
                .sort({ data_lettura: -1, _id: -1 })
                .limit(80)
                .lean(),
        ]);
        const openInvoices = fatture.filter((fattura) => !fattura.scadenza?.saldo);

        res.status(200).json({
            cliente: {
                ...cliente,
                displayName: customerLabel(cliente),
            },
            contatori,
            fatture,
            letture,
            totals: {
                contatori: contatori.length,
                fatture: fatture.length,
                fattureAperte: openInvoices.length,
                letture: letture.length,
                daPagare: fromCents(sumCents(openInvoices, (fattura) => fattura.totale_fattura)),
            },
        });
    } catch (error) {
        sendServiceError(res, error, 'Area clienti non disponibile.');
    }
};

const downloadInvoicePdf = async (req, res) => {
    try {
        const clienteId = requireCustomerId(req);
        await Fattura.findOne({ _id: req.params.id, ...sueFatture(clienteId) })
            .select('_id')
            .orFail(() => notFound('Fattura non trovata.'))
            .lean();

        const { buffer, filename } = await generateInvoicePdf(req.params.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.status(200).send(buffer);
    } catch (error) {
        return sendServiceError(res, error, 'PDF della fattura non disponibile.');
    }
};

module.exports = {
    downloadInvoicePdf,
    getPortalData,
};
