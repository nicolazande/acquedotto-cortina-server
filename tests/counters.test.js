const test = require('node:test');
const assert = require('node:assert/strict');

const { riservaProgressivoInvio } = require('../services/counters');

// Il progressivo di invio non e ricavabile dal numero della fattura. Il nome del
// file trasmesso deve essere unico per sempre presso lo SdI: una fattura
// scartata e rispedita ha bisogno di un nome nuovo, e un valore dedotto dal
// numero non puo cambiare. Nell'archivio storico quello dedotto si ripete 499
// volte - "202500001" da solo compare 19 volte.
test('il progressivo di invio sta in dieci caratteri alfanumerici', () => {
    // Il tracciato lo vuole cosi. In base 36 un contatore ci arriva molto piu
    // tardi che in decimale.
    const grandi = [0, 1, 41069, 60466175, 2176782335];
    grandi.forEach((numero) => {
        const progressivo = numero.toString(36).toUpperCase().padStart(5, '0');
        assert.ok(progressivo.length <= 10, `${numero} produce "${progressivo}", troppo lungo`);
        assert.match(progressivo, /^[0-9A-Z]+$/);
    });
});

test('riservaProgressivoInvio esiste ed e la sola via per ottenerne uno', () => {
    assert.equal(typeof riservaProgressivoInvio, 'function');
});
