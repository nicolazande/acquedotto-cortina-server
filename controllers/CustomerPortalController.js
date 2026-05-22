const Cliente = require('../models/Cliente');
const Contatore = require('../models/Contatore');
const Fattura = require('../models/Fattura');
const Lettura = require('../models/Lettura');
const { generateInvoicePdf } = require('../services/invoicePdf');

const customerName = (cliente) => (
    cliente?.ragione_sociale
    || [cliente?.cognome, cliente?.nome].filter(Boolean).join(' ').trim()
    || ''
);

const getCustomerId = (req) => req.user?.cliente?._id || req.user?.cliente;

const requireCustomerId = (req) => {
    const clienteId = getCustomerId(req);
    if (!clienteId) {
        const error = new Error('Account cliente non collegato ad alcuna anagrafica');
        error.status = 403;
        throw error;
    }
    return clienteId;
};

const openInvoiceTotal = (fattura) => (fattura.scadenza?.saldo ? 0 : Number(fattura.totale_fattura || 0));

const getPortalData = async (req, res) => {
    try {
        const clienteId = requireCustomerId(req);
        const cliente = await Cliente.findById(clienteId)
            .select('ragione_sociale cognome nome codice_cliente_erp indirizzo_residenza numero_residenza localita_residenza email telefono cellulare pagamento')
            .lean();

        if (!cliente) {
            return res.status(404).json({ error: 'Cliente non trovato' });
        }

        const contatori = await Contatore.find({ cliente: clienteId })
            .select('tipo_contatore codice nome_edificio tipo_attivita seriale seriale_interno inattivo consumo inizio scadenza')
            .sort({ inattivo: 1, nome_edificio: 1, seriale: 1 })
            .lean();
        const contatoreIds = contatori.map((contatore) => contatore._id);
        const [fatture, letture] = await Promise.all([
            Fattura.find({ cliente: clienteId })
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
                displayName: customerName(cliente),
            },
            contatori,
            fatture,
            letture,
            totals: {
                contatori: contatori.length,
                fatture: fatture.length,
                fattureAperte: openInvoices.length,
                letture: letture.length,
                daPagare: openInvoices.reduce((total, fattura) => total + openInvoiceTotal(fattura), 0),
            },
        });
    } catch (error) {
        console.error('[CustomerPortal] Error loading portal data:', error.message);
        res.status(error.status || 500).json({ error: error.message || 'Errore durante il recupero area clienti' });
    }
};

const downloadInvoicePdf = async (req, res) => {
    try {
        const clienteId = requireCustomerId(req);
        const fattura = await Fattura.findOne({ _id: req.params.id, cliente: clienteId }).select('_id').lean();

        if (!fattura) {
            return res.status(404).json({ error: 'Fattura non trovata' });
        }

        const { buffer, filename } = await generateInvoicePdf(req.params.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        return res.status(200).send(buffer);
    } catch (error) {
        console.error('[CustomerPortal] Error generating invoice PDF:', error.message);
        return res.status(error.status || 500).json({ error: error.message || 'Errore durante la generazione PDF' });
    }
};

module.exports = {
    downloadInvoicePdf,
    getPortalData,
};
