const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getCalculatedTotal,
    getExtraServices,
    getFixedLines,
    getFixedServices,
    getInvoiceYear,
    getMissingCalculatedBillingLines,
    getReadingIdsFromServices,
    getReadingServices,
    getServicesTotal,
} = require('../services/confrontoRighe');

// Quando due righe sono la stessa riga.
//
// E la domanda su cui si regge la verifica di una fattura: se la risposta e
// sbagliata, un documento corretto risulta incompleto - e il gestionale si offre
// di aggiungere righe che ci sono gia - oppure uno sbagliato risulta a posto.
// La regola e sottile (stesso articolo, stessa descrizione a meno di maiuscole e
// spazi, stessi importi a meno di un centesimo) ed era senza rete.
const riga = (extra = {}) => ({
    articolo: { codice: 'ACQUA' },
    tipo_tariffa: 'Consumo',
    tipo_quota: null,
    metri_cubi: 12,
    prezzo: 1.5,
    valore_unitario: 18,
    ...extra,
});

const calcolo = (righe, lettura = 'L1') => [{ lettura, lines: righe }];

test('una riga uguale in tutto e considerata gia presente', () => {
    assert.deepEqual(getMissingCalculatedBillingLines([riga()], calcolo([riga()])), []);
});

test('maiuscole e spazi non fanno una riga diversa', () => {
    const salvata = riga({ tipo_tariffa: '  CONSUMO  ' });
    assert.deepEqual(getMissingCalculatedBillingLines([salvata], calcolo([riga()])), []);
});

test('un centesimo di differenza non fa una riga diversa', () => {
    // Gli importi arrivano da due strade - quello che e stato scritto in fattura
    // e quello che il listino ricalcola oggi - e l'ultimo decimale puo ballare.
    const salvata = riga({ valore_unitario: 18.004 });
    assert.deepEqual(getMissingCalculatedBillingLines([salvata], calcolo([riga()])), []);
});

test('due centesimi invece si', () => {
    const salvata = riga({ valore_unitario: 18.02 });
    const mancanti = getMissingCalculatedBillingLines([salvata], calcolo([riga()]));
    assert.equal(mancanti.length, 1);
    assert.equal(mancanti[0].valore_unitario, 18);
});

test('cambiare articolo, tariffa o quantita fa una riga diversa', () => {
    [
        { articolo: { codice: 'ACQUAF' } },
        { tipo_tariffa: 'Quota fissa' },
        { tipo_quota: 'Q.Fissa' },
        { metri_cubi: 13 },
        { prezzo: 1.6 },
    ].forEach((differenza) => {
        const mancanti = getMissingCalculatedBillingLines([riga(differenza)], calcolo([riga()]));
        assert.equal(mancanti.length, 1, `${JSON.stringify(differenza)} doveva risultare una riga diversa`);
    });
});

test('il codice si legge anche dal dettaglio articolo, come arriva popolato', () => {
    const salvata = riga({ articolo: undefined, articolo_dettaglio: { codice: 'ACQUA' } });
    assert.deepEqual(getMissingCalculatedBillingLines([salvata], calcolo([riga()])), []);
});

test('una riga salvata vale per una riga calcolata sola', () => {
    // Due righe identiche calcolate e una sola in fattura: ne manca una. Senza
    // consumare la corrispondenza, la stessa riga salvata coprirebbe entrambe e
    // la fattura sembrerebbe completa.
    const mancanti = getMissingCalculatedBillingLines([riga()], calcolo([riga(), riga()]));
    assert.equal(mancanti.length, 1);
});

test('la lettura di provenienza segue la riga mancante', () => {
    const mancanti = getMissingCalculatedBillingLines([], calcolo([riga()], 'L7'));
    assert.equal(mancanti[0].lettura, 'L7');
});

test('le righe si dividono fra quelle di una lettura e le altre', () => {
    const servizi = [
        { lettura: 'L1', valore_unitario: 10 },
        { lettura: null, valore_unitario: 6 },
        { lettura: 'L2', valore_unitario: 4 },
    ];

    assert.equal(getReadingServices(servizi).length, 2);
    assert.equal(getExtraServices(servizi).length, 1);
    assert.deepEqual(getReadingIdsFromServices(servizi).map(String), ['L1', 'L2']);
    assert.equal(getServicesTotal(servizi), 20);
});

test('e quota fissa chi ha un tipo di quota, o lo dice nella tariffa', () => {
    const righe = [
        { tipo_quota: 'Q.Fissa' },
        { tipo_tariffa: 'Canone fisso annuale' },
        { tipo_tariffa: 'FISSO condominiale' },
        { tipo_tariffa: 'Consumo' },
    ];

    assert.equal(getFixedServices(righe).length, 3);
    assert.equal(getFixedLines(righe).length, 3);
});

test('il totale calcolato somma l imponibile di ogni lettura', () => {
    // Somma i totali gia calcolati, non le righe: l'imponibile di una lettura
    // tiene conto anche di cio che non e una riga a consumo.
    assert.equal(getCalculatedTotal([
        { totals: { imponibile: 15.5 } },
        { totals: { imponibile: 4.5 } },
    ]), 20);
});

test('l anno della fattura viene dal campo, o dalla data se manca', () => {
    assert.equal(getInvoiceYear({ anno: 2025, data_fattura: '2026-01-10' }), 2025);
    assert.equal(getInvoiceYear({ data_fattura: '2026-01-10' }), 2026);
});
