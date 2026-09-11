const test = require('node:test');
const assert = require('node:assert/strict');

const { frazioneDiAnno, mesiDiServizio, rateoQuotaFissa } = require('../services/rateoQuotaFissa');

// La frazione e in dodicesimi: riportarla ai mesi rende i test leggibili.
const mesi = (frazione) => Math.round(frazione * 12);

test('un contatore attivo tutto l anno paga la quota intera', () => {
    assert.equal(frazioneDiAnno({ inizio: '2020-01-01', fine: null, anno: 2026 }), 1);
    assert.equal(frazioneDiAnno({ inizio: '2026-01-01', fine: '2026-12-31', anno: 2026 }), 1);
});

test('la data di fine del gestionale precedente non riduce niente', () => {
    // 31/12/2099 non e una cessazione: e il suo modo di dire "ancora in
    // servizio". Presa alla lettera darebbe comunque 1, ma va riconosciuta.
    assert.equal(frazioneDiAnno({ inizio: '2020-01-01', fine: '2099-12-31', anno: 2026 }), 1);
});

test('chi cessa in corso d anno paga i mesi di servizio, quello di cessazione compreso', () => {
    // Cessato il 10 settembre: l'acqua c'e stata anche a settembre, quindi da
    // gennaio a settembre sono nove mesi su dodici.
    const frazione = frazioneDiAnno({ inizio: '2020-01-01', fine: '2026-09-10', anno: 2026 });
    assert.equal(mesi(frazione), 9);
    assert.equal(Number((99 * frazione).toFixed(2)), 74.25);
});

test('chi entra in corso d anno paga dal mese in cui entra, quel mese compreso', () => {
    // Il 27 aprile: da aprile a dicembre, nove mesi. E come il gestionale
    // precedente li contava nell'elenco per l'Anagrafe Tributaria.
    assert.equal(mesi(frazioneDiAnno({ inizio: '2026-04-27', fine: null, anno: 2026 })), 9);
    assert.equal(mesi(frazioneDiAnno({ inizio: '2026-03-10', fine: null, anno: 2026 })), 10);
});

test('attivato e cessato nello stesso anno: contano i mesi in mezzo, estremi compresi', () => {
    // Dal 10 marzo al 10 settembre: da marzo a settembre, sette mesi.
    assert.equal(mesi(frazioneDiAnno({ inizio: '2026-03-10', fine: '2026-09-10', anno: 2026 })), 7);
    // Dentro lo stesso mese si paga quel mese.
    assert.equal(mesi(frazioneDiAnno({ inizio: '2026-05-03', fine: '2026-05-28', anno: 2026 })), 1);
});

test('il giorno del mese non conta: chi cessa il 1 e chi cessa il 30 pagano uguale', () => {
    const primo = frazioneDiAnno({ inizio: '2020-01-01', fine: '2026-09-01', anno: 2026 });
    const trenta = frazioneDiAnno({ inizio: '2020-01-01', fine: '2026-09-30', anno: 2026 });
    assert.equal(primo, trenta);
    // Cessare il 1 gennaio non vuol dire non aver mai avuto acqua.
    assert.equal(mesi(frazioneDiAnno({ inizio: '2020-01-01', fine: '2026-01-01', anno: 2026 })), 1);
});

test('su un subentro il mese del cambio lo pagano tutti e due', () => {
    // E una conseguenza della regola, scritta qui perche non sorprenda: Dimai
    // cessa il 9 marzo, Baldin entra il 10, e marzo lo pagano entrambi.
    const uscente = frazioneDiAnno({ inizio: '2020-01-01', fine: '2025-03-09', anno: 2025 });
    const subentrante = frazioneDiAnno({ inizio: '2025-03-10', fine: null, anno: 2025 });
    assert.equal(mesi(uscente), 3);
    assert.equal(mesi(subentrante), 10);
});

test('fuori dall anno non si paga niente', () => {
    assert.equal(frazioneDiAnno({ inizio: '2020-01-01', fine: '2025-06-30', anno: 2026 }), 0);
    assert.equal(frazioneDiAnno({ inizio: '2027-01-01', fine: null, anno: 2026 }), 0);
    // A cavallo d'anno conta solo la parte che cade nell'anno.
    assert.equal(mesi(frazioneDiAnno({ inizio: '2025-11-15', fine: '2026-02-10', anno: 2026 })), 2);
});

test('un contatore senza date paga intero, come si e sempre fatturato', () => {
    assert.equal(rateoQuotaFissa({ contatore: {}, anno: 2026 }), 1);
    assert.equal(rateoQuotaFissa({ contatore: { inizio: null, scadenza: null }, anno: 2026 }), 1);
});

test('senza un anno di riferimento non si riduce niente', () => {
    // Meglio la quota intera - che e come si e sempre fatturato - di una
    // riduzione decisa su un anno indovinato.
    assert.equal(rateoQuotaFissa({ contatore: { inizio: '2026-03-10' }, anno: null }), 1);
});

test('il rateo arriva al calcolo dalle date del contatore', () => {
    assert.equal(mesi(rateoQuotaFissa({ contatore: { scadenza: '2026-09-10' }, anno: 2026 })), 9);
});

test('i mesi di servizio sono interi, da zero a dodici', () => {
    // E lo stesso numero che l'Anagrafe Tributaria scrive nel tracciato.
    assert.equal(mesiDiServizio({ inizio: '2026-04-27', fine: null, anno: 2026 }), 9);
    assert.equal(mesiDiServizio({ inizio: '2020-01-01', fine: '2099-12-31', anno: 2026 }), 12);
    assert.equal(mesiDiServizio({ inizio: '2027-01-01', fine: null, anno: 2026 }), 0);
});
