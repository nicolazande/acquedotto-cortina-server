// Viste predefinite delle liste: sono le domande che si fanno davvero ogni giorno
// ("quali scadenze sono scadute", "quali letture devo ancora fatturare").
// Vivono sul server perche il client possa solo sceglierne una, non comporre
// interrogazioni arbitrarie, e perche restino verificabili con i test.

// Il flag puo mancare del tutto sui record importati dal gestionale precedente.
const nonImpostato = (campo) => ({ $or: [{ [campo]: false }, { [campo]: { $exists: false } }] });

// `saldo` puo mancare sui record piu vecchi: assente equivale a non saldata.
const NON_SALDATA = nonImpostato('saldo');
const SALDATA = { saldo: true };

const scadenzaViews = {
    aperte: () => NON_SALDATA,
    scadute: () => ({ $and: [NON_SALDATA, { scadenza: { $lte: new Date() } }] }),
    'in-arrivo': () => ({ $and: [NON_SALDATA, { scadenza: { $gt: new Date() } }] }),
    saldate: () => SALDATA,
};

const letturaViews = {
    'da-fatturare': () => nonImpostato('fatturata'),
    fatturate: () => ({ fatturata: true }),
};

const fatturaViews = {
    bozze: () => ({ stato: 'bozza' }),
    confermate: () => ({ stato: 'confermata' }),
    'senza-scadenza': () => ({ $or: [{ scadenza: null }, { scadenza: { $exists: false } }] }),
};

const contatoreViews = {
    attivi: () => nonImpostato('inattivo'),
    inattivi: () => ({ inattivo: true }),
    condominiali: () => ({ tipo_contatore: /condominiale/i }),
};

const clienteViews = {
    soci: () => ({ socio: true }),
    'con-email': () => ({ email: { $nin: [null, ''] } }),
    'fatturazione-elettronica': () => ({ fattura_elettronica: true }),
};

module.exports = {
    clienteViews,
    contatoreViews,
    fatturaViews,
    letturaViews,
    scadenzaViews,
};
