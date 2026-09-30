const test = require('node:test');
const assert = require('node:assert/strict');

const { abiDellIban, cabDellIban, ibanLeggibile, ibanNascosto, ibanValido } = require('../utils/iban');

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

test('un IBAN estero non ha ABI ne CAB: quelle posizioni dicono altro', () => {
    assert.equal(abiDellIban('GB29NWBK60161331926819'), '');
    assert.equal(cabDellIban('GB29NWBK60161331926819'), '');
    assert.equal(abiDellIban('SM86U0322509800000000270100'), '03225');
});

test('un valore assente non fa saltare il documento', () => {
    assert.equal(abiDellIban(undefined), '');
    assert.equal(ibanLeggibile(null), '');
});

test('un IBAN vale se forma, lunghezza e cifre di controllo tornano', () => {
    assert.equal(ibanValido(CONTO), true);
    assert.equal(ibanValido('it11m 08511 61070 0000 0000 6953'), true);
    // Una cifra cambiata, un carattere di troppo, il CIN al posto sbagliato.
    assert.equal(ibanValido('IT11M0851161070000000006954'), false);
    assert.equal(ibanValido('IT56O05387A65690000002411149'), false);
    assert.equal(ibanValido('ITY0851161070000000027314'), false);
    assert.equal(ibanValido(''), false);
    assert.equal(ibanValido(undefined), false);
});

test('in busta il conto del cliente si riconosce senza leggerlo per intero', () => {
    assert.equal(ibanNascosto(CONTO), 'IT11 ******************* 6953');
    assert.equal(ibanNascosto(''), '');
});
