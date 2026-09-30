// I controlli delle fatture: il totale torna con le righe, le righe con il
// listino, la quota fissa c'e dove e dovuta, il cliente e la scadenza ci sono.
//
// Si controllano tutte le fatture chieste, non le piu recenti: prima erano le
// ultime duecento, e dopo un giro di settecento bozze il controllo ne guardava
// una su tre. Due modi: tutte le bozze da confermare, qualunque sia l'anno,
// oppure tutte le fatture di un anno. Dalle bozze senza errori parte la
// conferma in blocco.

const Fattura = require('../models/Fattura');
const { buildAnnualFixedLookupCache } = require('./annualFixedChargeService');
const { problemiDelCalcolo, verifyInvoiceCalculation } = require('./verificaFattura');
const { FILTRO_CONFERMATE, FILTRO_EMESSE_DAL_GESTIONALE, isConfirmedInvoice, numeroDocumento } = require('../config/invoicing');
const { customerLabel } = require('../utils/customer');


// Le fatture si controllano qualcuna alla volta. Una per volta, con il server e
// il database in due posti diversi, settecento bozze richiedevano minuti: il
// tempo e quasi tutto attesa della rete, non calcolo.
const QUANTE_INSIEME = 8;

const perOgnuna = async (elementi, operazione) => {
    const risultati = new Array(elementi.length);
    let prossimo = 0;
    const lavora = async () => {
        while (prossimo < elementi.length) {
            const indice = prossimo;
            prossimo += 1;
            risultati[indice] = await operazione(elementi[indice]);
        }
    };

    await Promise.all(Array.from({ length: Math.min(QUANTE_INSIEME, elementi.length) }, lavora));
    return risultati;
};

// Le bozze da confermare sono quelle nate qui. Una bozza importata dal vecchio
// programma - se ce n'e - ha un numero che non e della serie, e confermarla in
// blocco la numererebbe nel suo anno: si guarda e si conferma dalla sua scheda.
// "Importata" e il contrario di FILTRO_EMESSE_DAL_GESTIONALE, la regola di tutto
// il gestionale: scritta a parte, su una serie vuota le due dicevano cose opposte.
const BOZZA_IMPORTATA = { $nor: [FILTRO_EMESSE_DAL_GESTIONALE], numero: { $gt: 0 } };

const getControlsQuery = ({ stato, year } = {}) => {
    if (stato === 'bozze') {
        return { query: { $nor: [FILTRO_CONFERMATE, BOZZA_IMPORTATA] }, year: null };
    }

    const anno = Number(year) > 0 ? Number(year) : new Date().getFullYear();
    return { query: { anno }, year: anno };
};

const createSummary = (year) => ({
    anno: year,
    controllate: 0,
    confermate: 0,
    bozze: 0,
    senzaCliente: 0,
    senzaScadenza: 0,
    scostamentoFattura: 0,
    scostamentoListino: 0,
    quotaFissaApplicabile: 0,
    erroriCalcolo: 0,
});

const getCustomerLabel = (fattura) => customerLabel(fattura.cliente, fattura) || undefined;

const createIssue = (fattura, type, severity, message, extra = {}) => ({
    _id: `${fattura._id}-${type}`,
    fatturaId: fattura._id,
    type,
    severity,
    message,
    anno: fattura.anno,
    numero: fattura.numero,
    serie: fattura.serie,
    documento: numeroDocumento(fattura),
    data_fattura: fattura.data_fattura,
    // Il nome basta: l'anagrafica intera, ripetuta su centinaia di righe, era
    // quasi tutta la risposta.
    cliente: fattura.cliente?._id || fattura.cliente,
    clienteLabel: getCustomerLabel(fattura),
    imponibile: fattura.imponibile,
    totale_fattura: fattura.totale_fattura,
    confermata: fattura.confermata,
    stato: fattura.stato,
    ...extra,
});

const inspectInvoice = async (fattura, memoria) => {
    const issues = [];
    const counters = createSummary(null);

    if (isConfirmedInvoice(fattura)) counters.confermate = 1;
    else counters.bozze = 1;

    if (!fattura.cliente) {
        counters.senzaCliente = 1;
        issues.push(createIssue(fattura, 'cliente', 'danger', 'Cliente mancante'));
    }

    if (!fattura.scadenza) {
        counters.senzaScadenza = 1;
        issues.push(createIssue(fattura, 'scadenza', 'warning', 'Scadenza mancante'));
    }

    try {
        const verification = await verifyInvoiceCalculation(fattura._id, { ...memoria, fattura });
        // Le regole stanno in `problemiDelCalcolo`, le stesse della scheda.
        problemiDelCalcolo(verification.summary).forEach((problema) => {
            counters[problema.contatore] = 1;
            issues.push(createIssue(fattura, problema.tipo, problema.gravita, problema.messaggio, { delta: problema.delta }));
        });
    } catch (error) {
        counters.erroriCalcolo = 1;
        issues.push(createIssue(fattura, 'calcolo', 'danger', error.message || 'Calcolo non verificabile'));
    }

    return { counters, issues };
};

const addCounters = (target, source) => {
    Object.keys(target).forEach((key) => {
        if (typeof target[key] === 'number' && key !== 'anno') {
            target[key] += source[key] || 0;
        }
    });
};

const getInvoiceControlDashboard = async (options = {}) => {
    const { query, year } = getControlsQuery(options);
    const fatture = await Fattura.find(query)
        .sort({ data_fattura: 1, createdAt: 1, _id: 1 })
        .populate('cliente scadenza')
        .lean();
    // Le memorie del giro: quote fisse gia fatturate e fasce dei listini, lette
    // una volta per tutte le fatture invece che per ognuna.
    const memoria = {
        annualFixedLookupCache: await buildAnnualFixedLookupCache(),
        fascePerListino: new Map(),
    };
    const risultati = await perOgnuna(fatture, (fattura) => inspectInvoice(fattura, memoria));
    const summary = createSummary(year);
    summary.controllate = fatture.length;
    risultati.forEach((result) => addCounters(summary, result.counters));

    const issues = risultati.flatMap((result) => result.issues);
    // Quanti problemi per gravita: la pagina li mostra cosi, e prima li
    // risommava a mano per nome, con il rischio di contare un problema nuovo
    // sotto la gravita sbagliata.
    summary.perGravita = { danger: 0, warning: 0, info: 0 };
    issues.forEach((issue) => {
        summary.perGravita[issue.severity] = (summary.perGravita[issue.severity] || 0) + 1;
    });

    // Una bozza si conferma se nessun controllo ha trovato un errore: gli
    // avvisi sono da guardare, ma non fermano la conferma.
    const conErrori = new Set(issues
        .filter((issue) => issue.severity === 'danger')
        .map((issue) => String(issue.fatturaId)));

    return {
        issues,
        confermabili: fatture
            .filter((fattura) => !isConfirmedInvoice(fattura) && !conErrori.has(String(fattura._id)))
            .map((fattura) => fattura._id),
        summary,
    };
};

module.exports = {
    getInvoiceControlDashboard,
};
