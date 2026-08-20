const test = require('node:test');
const assert = require('node:assert/strict');

const {
    assertInvoiceEditable,
    isConfirmedInvoice,
    unlockOptions,
} = require('../services/invoiceLockService');

const confermata = { confermata: true, stato: 'confermata' };
const bozza = { confermata: false, stato: 'bozza' };

test('una bozza si modifica senza conferme', () => {
    assert.equal(assertInvoiceEditable(bozza, 'modificare'), false);
    assert.equal(assertInvoiceEditable({}, 'modificare'), false);
});

test('una fattura confermata resta protetta per impostazione predefinita', () => {
    assert.throws(() => assertInvoiceEditable(confermata, 'modificare la fattura'), (errore) => {
        assert.equal(errore.status, 409);
        assert.match(errore.message, /Fattura confermata/);
        return true;
    });
});

test('con conferma esplicita la modifica e permessa e segnalata', () => {
    // Il valore di ritorno dice al chiamante che sta agendo su un documento gia
    // emesso: e quello che permette di registrarlo come tale nel giornale.
    assert.equal(assertInvoiceEditable(confermata, 'modificare', { sbloccoConfermato: true }), true);
});

test('una conferma mancante o falsa non sblocca nulla', () => {
    [{}, { sbloccoConfermato: false }, { sbloccoConfermato: 'no' }].forEach((opzioni) => {
        assert.throws(
            () => assertInvoiceEditable(confermata, 'modificare', opzioni),
            /Fattura confermata/,
            `le opzioni ${JSON.stringify(opzioni)} non devono sbloccare`
        );
    });
});

test('unlockOptions legge la conferma dal corpo o dalla querystring', () => {
    // La cancellazione e le associazioni non hanno corpo: la conferma deve poter
    // viaggiare anche come parametro dell'indirizzo.
    assert.deepEqual(unlockOptions({ body: { sbloccoConfermato: true } }), { sbloccoConfermato: true });
    assert.deepEqual(unlockOptions({ query: { sbloccoConfermato: 'true' } }), { sbloccoConfermato: true });
    assert.deepEqual(unlockOptions({ body: { sbloccoConfermato: 'si' } }), { sbloccoConfermato: true });
    assert.deepEqual(unlockOptions({}), { sbloccoConfermato: false });
    assert.deepEqual(unlockOptions(), { sbloccoConfermato: false });
    assert.deepEqual(unlockOptions({ body: {} }), { sbloccoConfermato: false });
});

test('lo stato confermato si riconosce da entrambi i campi', () => {
    assert.equal(isConfirmedInvoice({ confermata: true }), true);
    assert.equal(isConfirmedInvoice({ stato: 'Confermata' }), true);
    assert.equal(isConfirmedInvoice(bozza), false);
});
