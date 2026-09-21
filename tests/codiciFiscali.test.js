const test = require('node:test');
const assert = require('node:assert/strict');

const { codiceFiscaleValido, partitaIvaValida } = require('../utils/codiciFiscali');

test('la partita IVA dell acquedotto e quella del comune sono valide', () => {
    assert.equal(partitaIvaValida('00296800253'), true);
    assert.equal(partitaIvaValida('00087640256'), true);
});

test('una cifra sbagliata nella partita IVA si vede dal controllo', () => {
    assert.equal(partitaIvaValida('00296800254'), false);
    assert.equal(partitaIvaValida('0029680025'), false, 'dieci cifre non bastano');
    assert.equal(partitaIvaValida('IT00296800253'), false, 'il prefisso del paese non fa parte del codice');
});

test('il codice fiscale di una persona si verifica con la lettera finale', () => {
    // Codici di esempio dei documenti dell'Agenzia delle Entrate.
    assert.equal(codiceFiscaleValido('RSSMRA85T10A562S'), true);
    assert.equal(codiceFiscaleValido('rssmra85t10a562s'), true, 'maiuscole o minuscole non contano');
    assert.equal(codiceFiscaleValido('RSSMRA85T10A562T'), false);
    assert.equal(codiceFiscaleValido('RSSMRA85T10A56'), false);
});

test('un codice di omocodia, con lettere al posto delle cifre, resta valido', () => {
    // Stesso codice di sopra, con l'ultima cifra (2) sostituita dalla lettera N.
    assert.equal(codiceFiscaleValido('RSSMRA85T10A56NH'), true);
});

test('il codice fiscale di una societa ha il controllo della partita IVA', () => {
    assert.equal(codiceFiscaleValido('00296800253'), true);
    assert.equal(codiceFiscaleValido('00296800250'), false);
});

test('un valore assente non e valido e non fa saltare niente', () => {
    assert.equal(codiceFiscaleValido(undefined), false);
    assert.equal(partitaIvaValida(null), false);
});
