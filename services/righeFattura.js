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

// Le righe come le mostra un documento: descrizione, importo e articolo, che e
// quello che porta l'aliquota.
const righeDellaFattura = (fatturaId, session) => withSession(
    Servizio.find({ fattura: fatturaId }),
    session
).populate('articolo').sort(ORDINE).lean();

// Le righe con tutto cio da cui sono nate, per ricalcolarle o verificarle.
const righeConOrigine = (fatturaId, session) => withSession(
    Servizio.find({ fattura: fatturaId }),
    session
).populate([
    { path: 'articolo' },
    { path: 'listino' },
    { path: 'fascia' },
    { path: 'lettura', populate: { path: 'contatore' } },
]).sort(ORDINE).lean();

module.exports = {
    righeConOrigine,
    righeDellaFattura,
};
