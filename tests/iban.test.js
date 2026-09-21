const test = require('node:test');
const assert = require('node:assert/strict');

const { abiDellIban, cabDellIban, ibanLeggibile } = require('../utils/iban');

const CONTO = 'IT11M0851161070000000006953';

test('ABI e CAB si leggono dentro l IBAN', () => {
    // Scriverli in configurazione accanto al conto voleva dire tenere allineati
    // tre valori che dicono la stessa cosa.
    assert.equal(abiDellIban(CONTO), '08511');
    assert.equal(cabDellIban(CONTO), '61070');
});

test('gli spazi di chi lo ha scritto non contano', () => {
    assert.equal(abiDellIban('IT11M 08511 61070 0000 0000 6953'), '08511');
    assert.equal(cabDellIban('IT11M 08511 61070 0000 0000 6953'), '61070');
});

test('sul documento si scrive a gruppi, nel tracciato tutto attaccato', () => {
    assert.equal(ibanLeggibile(CONTO), 'IT11M 08511 61070 0000 0000 6953');
    assert.equal(ibanLeggibile('IT11M 08511 61070 0000 0000 6953'), 'IT11M 08511 61070 0000 0000 6953');
});

test('un valore assente non fa saltare il documento', () => {
    assert.equal(abiDellIban(undefined), '');
    assert.equal(ibanLeggibile(null), '');
});
