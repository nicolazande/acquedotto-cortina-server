const test = require('node:test');
const assert = require('node:assert/strict');

const { numeroRiusabile } = require('../services/invoiceDeletionService');
const { scopeDellaSerie } = require('../services/counters');

// Una fattura di prova: serie nuova, mai uscita.
const fattura = (modifiche = {}) => ({ anno: 2026, serie: 'A', numero: 3, ...modifiche });

test('una fattura mai uscita libera il suo numero', () => {
    // E il caso delle fatture di prova: generate, controllate, cancellate.
    assert.equal(numeroRiusabile({ fattura: fattura(), consegne: [] }), true);
    assert.equal(numeroRiusabile({ fattura: fattura(), consegne: [{ tipo: 'cortesia', stato: 'in_coda' }] }), true);
});

test('una consegna simulata non e uscita', () => {
    // Senza server di posta l'invio viene registrato come simulato: niente e
    // partito, quindi il numero non e in mano a nessuno.
    const consegne = [{ tipo: 'cortesia', stato: 'inviata', simulata: true }];
    assert.equal(numeroRiusabile({ fattura: fattura(), consegne }), true);
});

test('una consegna evasa davvero tiene il numero', () => {
    // La busta imbucata, la fattura ritirata allo sportello: il cliente ha un
    // documento con quel numero, e un altro non puo averlo.
    const consegne = [{ tipo: 'cortesia', stato: 'inviata', simulata: false }];
    assert.equal(numeroRiusabile({ fattura: fattura(), consegne }), false);
});

test('un file XML gia prodotto tiene il numero', () => {
    // Qualcuno puo averlo caricato sul portale dello SdI senza dirlo al
    // gestionale: nel dubbio il numero resta di quel documento.
    const consegne = [{ tipo: 'elettronica', stato: 'in_coda', progressivo: '0000A' }];
    assert.equal(numeroRiusabile({ fattura: fattura(), consegne }), false);
});

test('una data di invio sulla fattura tiene il numero, anche scritta a mano', () => {
    assert.equal(numeroRiusabile({ fattura: fattura({ data_invio_fattura: new Date() }) }), false);
    assert.equal(numeroRiusabile({ fattura: fattura({ data_fattura_elettronica: new Date() }) }), false);
});

test('lo storico importato non libera niente', () => {
    // Senza serie il numero non e un progressivo: nel gestionale precedente
    // era un altro dato, e non c'e un contatore da riallineare.
    assert.equal(numeroRiusabile({ fattura: fattura({ serie: undefined }) }), false);
    assert.equal(numeroRiusabile({ fattura: fattura({ numero: null }) }), false);
    assert.equal(numeroRiusabile({ fattura: fattura({ anno: null }) }), false);
});

test('chi assegna i numeri e chi li libera parlano dello stesso contatore', () => {
    assert.equal(scopeDellaSerie('A'), 'fatture:A');
});
