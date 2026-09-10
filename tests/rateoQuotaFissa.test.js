const test = require('node:test');
const assert = require('node:assert/strict');

const { frazioneDiAnno, rateoQuotaFissa } = require('../services/rateoQuotaFissa');

const percento = (valore) => Number((valore * 100).toFixed(2));

test('un contatore attivo tutto l anno paga la quota intera', () => {
    assert.equal(frazioneDiAnno({ inizio: '2020-01-01', fine: null, anno: 2026 }), 1);
    assert.equal(frazioneDiAnno({ inizio: '2026-01-01', fine: '2026-12-31', anno: 2026 }), 1);
});

test('la data di fine del gestionale precedente non riduce niente', () => {
    // 31/12/2099 non e una cessazione: e il suo modo di dire "ancora in
    // servizio". Presa alla lettera darebbe comunque 1, ma va riconosciuta.
    assert.equal(frazioneDiAnno({ inizio: '2020-01-01', fine: '2099-12-31', anno: 2026 }), 1);
});

test('chi cessa in corso d anno paga i giorni di servizio', () => {
    // Dal 1 gennaio al 10 settembre 2026 sono 253 giorni su 365.
    const frazione = frazioneDiAnno({ inizio: '2020-01-01', fine: '2026-09-10', anno: 2026 });
    assert.equal(percento(frazione), 69.32);
    assert.equal(Number((99 * frazione).toFixed(2)), 68.62);
});

test('chi viene attivato in corso d anno paga dal giorno dell attivazione', () => {
    // Dal 10 marzo al 31 dicembre 2026: 297 giorni su 365.
    assert.equal(percento(frazioneDiAnno({ inizio: '2026-03-10', fine: null, anno: 2026 })), 81.37);
});

test('attivato e cessato nello stesso anno: conta solo il tratto in mezzo', () => {
    // Dal 10 marzo al 10 settembre: 185 giorni.
    assert.equal(percento(frazioneDiAnno({ inizio: '2026-03-10', fine: '2026-09-10', anno: 2026 })), 50.68);
});

test('il giorno di cessazione si paga, quello dopo no', () => {
    // Cessare il 1 gennaio non vuol dire non aver mai avuto acqua: quel giorno
    // il servizio c e stato.
    assert.equal(percento(frazioneDiAnno({ inizio: '2020-01-01', fine: '2026-01-01', anno: 2026 })), 0.27);
    assert.equal(percento(frazioneDiAnno({ inizio: '2020-01-01', fine: '2026-12-31', anno: 2026 })), 100);
});

test('fuori dall anno non si paga niente', () => {
    assert.equal(frazioneDiAnno({ inizio: '2020-01-01', fine: '2025-06-30', anno: 2026 }), 0);
    assert.equal(frazioneDiAnno({ inizio: '2027-01-01', fine: null, anno: 2026 }), 0);
});

test('gli anni bisestili si contano per quello che sono', () => {
    // Il 2028 ha 366 giorni: mezzo anno non e lo stesso numero di giorni.
    assert.equal(frazioneDiAnno({ inizio: '2028-01-01', fine: '2028-12-31', anno: 2028 }), 1);
    assert.equal(percento(frazioneDiAnno({ inizio: '2028-01-01', fine: '2028-06-30', anno: 2028 })), 49.73);
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
