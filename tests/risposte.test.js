// Come i controller rispondono: i file e gli errori.
const test = require('node:test');
const assert = require('node:assert/strict');

const { disposizione, inviaFile } = require('../controllers/utils/inviaFile');
const { sendServiceError } = require('../controllers/utils/controllerActions');

const rispostaFinta = () => {
    const intestazioni = {};
    return {
        intestazioni,
        setHeader: (nome, valore) => { intestazioni[nome] = valore; },
        status(codice) { this.codice = codice; return this; },
        send(corpo) { this.corpo = corpo; return this; },
    };
};

test('un file parte con tipo, nome e lunghezza in byte', () => {
    const res = rispostaFinta();
    inviaFile(res, { contenuto: '<Descrizione>Ca’ Zuel</Descrizione>', nome: 'IT00296800253_00001.xml', tipo: 'application/xml', scarica: true });

    assert.equal(res.codice, 200);
    assert.equal(res.intestazioni['Content-Type'], 'application/xml');
    // L'apostrofo tipografico sono tre byte: la lunghezza non e quella della stringa.
    assert.equal(res.intestazioni['Content-Length'], Buffer.byteLength('<Descrizione>Ca’ Zuel</Descrizione>'));
    assert.match(res.intestazioni['Content-Disposition'], /^attachment; filename="IT00296800253_00001\.xml"/);
});

test('le intestazioni in piu viaggiano con il file', () => {
    const res = rispostaFinta();
    inviaFile(res, { contenuto: Buffer.from('%PDF'), nome: 'stampa.pdf', tipo: 'application/pdf', intestazioni: { 'X-Consegne-Rimaste': 3 } });

    assert.equal(res.intestazioni['X-Consegne-Rimaste'], '3');
    assert.match(res.intestazioni['Content-Disposition'], /^inline;/);
});

test('un nome con virgolette o simboli non rompe l intestazione', () => {
    const valore = disposizione('preventivo "urgente" 100€ è.pdf', false);

    assert.match(valore, /filename="preventivo _urgente_ 100_ e\.pdf"/);
    assert.match(valore, /filename\*=UTF-8''preventivo%20%22urgente%22%20100%E2%82%AC%20%C3%A8\.pdf$/);
    // Solo caratteri che un'intestazione HTTP accetta.
    assert.match(valore, /^[\x20-\x7e]+$/);
    // L'apostrofo nella forma esatta va codificato anche lui.
    assert.match(disposizione("Fattura dell'acqua (2026).pdf", true), /filename\*=UTF-8''Fattura%20dell%27acqua%20%282026%29\.pdf$/);
});

test('un identificativo malformato e una richiesta sbagliata, non un guasto del server', () => {
    const res = { status(codice) { this.codice = codice; return this; }, json(corpo) { this.corpo = corpo; return this; } };
    const errore = Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError', kind: 'ObjectId' });

    sendServiceError(res, errore, 'File XML della fattura non generato.');

    assert.equal(res.codice, 400);
    assert.deepEqual(res.corpo, { error: 'Identificativo non valido.' });
});
