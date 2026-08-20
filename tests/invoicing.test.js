const test = require('node:test');
const assert = require('node:assert/strict');

const { INVOICE_SERIES, invoiceCode } = require('../config/invoicing');

test('il codice documento unisce anno, serie e numero', () => {
    assert.equal(invoiceCode({ anno: 2026, numero: 1, serie: 'A' }), '2026/A/1');
    assert.equal(invoiceCode({ anno: 2026, numero: 128, serie: 'A' }), '2026/A/128');
});

test('senza serie non si costruisce un codice', () => {
    // Le fatture importate non hanno serie: il loro `numero` e un codice cliente
    // e non va presentato come progressivo di fattura.
    assert.equal(invoiceCode({ anno: 2026, numero: 2760 }), '');
    assert.equal(invoiceCode({}), '');
});

test('la serie predefinita e una sola lettera maiuscola', () => {
    assert.match(INVOICE_SERIES, /^[A-Z0-9]+$/);
});
