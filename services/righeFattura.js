// Come si leggono le righe di una fattura.
//
// Sette punti le caricavano, e due forme erano ripetute parola per parola: tre
// volte quella con l'articolo ordinata per riga, due volte quella che tira su
// anche lettura, listino e fascia. Ripetere una query e ripetere una decisione:
// basta che una copia dimentichi l'ordinamento - ed era successo - perche due
// schermate mostrino le stesse righe in ordine diverso.
//
// Qui stanno le due forme che servono davvero, con un nome che dice a cosa
// servono. Chi ha bisogno di meno - la cancellazione, che vuole solo gli id -
// continua a chiedere solo quello: caricare piu del necessario non e pulizia.
const Servizio = require('../models/Servizio');
const { withSession } = require('../utils/mongo');

// Sempre nell'ordine in cui vanno lette: la riga 1 e la prima, e a parita di
// numero decide l'ordine di creazione.
const ORDINE = { riga: 1, _id: 1 };

// Cosa si tira su insieme alle righe: l'articolo porta l'aliquota, il resto
// serve solo a chi deve ricalcolarle o verificarle.
const CON_ARTICOLO = 'articolo';
const CON_LETTURA = [{ path: 'articolo' }, { path: 'lettura', populate: { path: 'contatore' } }];
const CON_ORIGINE = [
    { path: 'articolo' },
    { path: 'listino' },
    { path: 'fascia' },
    { path: 'lettura', populate: { path: 'contatore' } },
];

const righe = (filtro, popolamento, session) => withSession(Servizio.find(filtro), session)
    .populate(popolamento)
    .sort(ORDINE)
    .lean();

// Le righe come le mostra un documento: descrizione, importo e articolo.
const righeDellaFattura = (fatturaId, session) => righe({ fattura: fatturaId }, CON_ARTICOLO, session);

// Le righe con tutto cio da cui sono nate, per ricalcolarle o verificarle.
const righeConOrigine = (fatturaId, session) => righe({ fattura: fatturaId }, CON_ORIGINE, session);

// Le righe come le disegna il PDF: l'articolo per l'aliquota e la lettura con il
// suo contatore, che sulla riga compare come matricola. Listino e fascia il
// disegno non li guarda, e tirarli su erano due letture in piu per ogni blocco.
const righeDelDocumento = (fatturaId, session) => righe({ fattura: fatturaId }, CON_LETTURA, session);

// Le righe di piu fatture in una lettura sola, raggruppate per fattura. La
// stampa in blocco e l'archivio degli XML le chiedevano una fattura per volta:
// con duecento documenti sono duecento andate e ritorni al database, e la
// distanza fra Render e il database si sente tutta.
const raggruppate = (trovate) => Map.groupBy(trovate, (riga) => String(riga.fattura));

const righeDelleFatture = async (fatturaIds) => raggruppate(await righe({ fattura: { $in: fatturaIds } }, CON_ARTICOLO));

const righeDeiDocumenti = async (fatturaIds) => raggruppate(await righe({ fattura: { $in: fatturaIds } }, CON_LETTURA));

module.exports = {
    righeConOrigine,
    righeDeiDocumenti,
    righeDelDocumento,
    righeDelleFatture,
    righeDellaFattura,
};
