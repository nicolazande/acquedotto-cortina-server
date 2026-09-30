// Viste predefinite delle liste: sono le domande che si fanno davvero ogni giorno
// ("quali scadenze sono scadute", "quali letture devo ancora fatturare").
// Vivono sul server perche il client possa solo sceglierne una, non comporre
// interrogazioni arbitrarie, e perche restino verificabili con i test.

const { IN_ARRIVO, NON_SALDATA, SALDATA, SCADUTA } = require('../models/Scadenza');
const { DA_FATTURARE } = require('../models/Lettura');
const { ALIAS_MODALITA, IN_UFFICIO, MODALITA_CONSEGNA, MODALITA_PREDEFINITA } = require('./delivery');
const { FILTRO_BOZZE, FILTRO_CONFERMATE } = require('./invoicing');
const { escapeRegex } = require('../utils/values');

// Il flag puo mancare del tutto sui record importati dal gestionale precedente.
const nonImpostato = (campo) => ({ $or: [{ [campo]: false }, { [campo]: { $exists: false } }] });

const scadenzaViews = {
    aperte: () => NON_SALDATA,
    scadute: () => ({ $and: [NON_SALDATA, SCADUTA()] }),
    'in-arrivo': () => ({ $and: [NON_SALDATA, IN_ARRIVO()] }),
    saldate: () => SALDATA,
};

const letturaViews = {
    'da-fatturare': () => DA_FATTURARE,
    fatturate: () => ({ fatturata: true }),
};

const fatturaViews = {
    bozze: () => FILTRO_BOZZE,
    confermate: () => FILTRO_CONFERMATE,
    'senza-scadenza': () => ({ $or: [{ scadenza: null }, { scadenza: { $exists: false } }] }),
};

const contatoreViews = {
    attivi: () => nonImpostato('inattivo'),
    inattivi: () => ({ inattivo: true }),
    // "condomin" e non "condominiale": nei dati il contatore comune e scritto
    // "Condominali Ripartiti", e la vista mostrava le utenze private e perdeva
    // proprio lui. Cosi sono i sei contatori dei riparti.
    condominiali: () => ({ tipo_contatore: /condomin/i }),
};

// La modalita di consegna era un campo di testo libero: i dati importati dicono
// "Cartacea Postale", non "postale". La vista accetta quindi tutte le scritture
// riconosciute per quella modalita, cosi funziona anche sulle anagrafiche non
// ancora normalizzate.
const scrittureDi = (modalita) => [
    modalita,
    ...Object.entries(ALIAS_MODALITA).filter(([, valore]) => valore === modalita).map(([alias]) => alias),
];

const filtroModalita = (modalita) => {
    const alternative = { stampa_cortesia: { $regex: `^(${scrittureDi(modalita).map(escapeRegex).join('|')})$`, $options: 'i' } };

    // La modalita predefinita vale anche per chi non ha mai avuto il campo compilato.
    return modalita === MODALITA_PREDEFINITA
        ? { $or: [alternative, { stampa_cortesia: { $in: [null, ''] } }, { stampa_cortesia: { $exists: false } }] }
        : alternative;
};

const clienteViews = {
    soci: () => ({ socio: true }),
    'con-email': () => ({ email: { $nin: [null, ''] } }),
    'fatturazione-elettronica': () => ({ fattura_elettronica: true }),
    ...Object.fromEntries(MODALITA_CONSEGNA.map(({ value }) => [
        `consegna-${value}`,
        () => filtroModalita(value),
    ])),
};

const consegnaViews = {
    'in-coda': () => ({ stato: 'in_coda' }),
    // Il lavoro d'ufficio: le fatture da stampare e imbustare o tenere pronte.
    'da-stampare': () => IN_UFFICIO.daStampare,
    automatiche: () => ({ stato: 'in_coda', automatica: true }),
    errori: () => ({ stato: 'errore' }),
    inviate: () => ({ stato: 'inviata' }),
    elettroniche: () => ({ tipo: 'elettronica' }),
};

module.exports = {
    clienteViews,
    consegnaViews,
    contatoreViews,
    fatturaViews,
    letturaViews,
    scadenzaViews,
};
