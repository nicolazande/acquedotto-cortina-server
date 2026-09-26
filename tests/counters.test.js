const test = require('node:test');
const assert = require('node:assert/strict');

const { componiCodiceInvio, progressivoDiInvio, riservaProgressiviInvio } = require('../services/counters');
const anagrafe = require('../config/anagrafeTributaria');

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
        const progressivo = progressivoDiInvio(numero);
        assert.ok(progressivo.length <= 10, `${numero} produce "${progressivo}", troppo lungo`);
        assert.match(progressivo, /^[0-9A-Z]+$/);
    });
    assert.equal(progressivoDiInvio(1), '00001');
    assert.equal(progressivoDiInvio(36), '00010');
});

test('riservaProgressiviInvio e la sola via per ottenerne, e per zero non scrive niente', async () => {
    assert.equal(typeof riservaProgressiviInvio, 'function');
    assert.deepEqual(await riservaProgressiviInvio(0), []);
});

// Il codice che identifica un file mandato all'Anagrafe Tributaria. Cambia a ogni
// file prodotto: quando il Desktop Telematico segnala un errore, l'elenco si
// corregge e si ristampa, e il file nuovo non puo portare il codice del vecchio.
test('il codice di invio e sei cifre di progressivo piu la data del giorno', () => {
    const quando = new Date('2026-09-16T00:00:00.000Z');

    assert.equal(componiCodiceInvio(210042, quando), '21004216092026');
    assert.equal(componiCodiceInvio(7, quando), '00000716092026');
    assert.equal(componiCodiceInvio(210042, quando).length, 14, 'lungo come quello di Gesco');
});

test('il progressivo riparte da dopo l ultimo codice del gestionale precedente', () => {
    // Cosi i codici gia mandati all'Agenzia non si ripetono.
    const ultimo = Number(anagrafe.ultimoCodiceInvio.slice(0, 6));

    assert.ok(Number.isInteger(ultimo) && ultimo > 0, 'il codice di partenza va letto dalla configurazione');
    assert.equal(componiCodiceInvio(ultimo + 1, new Date('2026-02-28T00:00:00.000Z')), '21004228022026');
});
