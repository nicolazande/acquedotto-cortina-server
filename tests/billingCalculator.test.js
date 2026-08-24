const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateReadingInvoice,
    calculateTotals,
    getApplicableBands,
    getBandQuantity,
    getTaxRate,
    isFixedBand,
} = require('../services/billingCalculator');
const { ARTICOLI, FASCE_STANDARD, contatore, fascia, lettura } = require('./helpers/fixtures');

const calcola = (overrides = {}) => calculateReadingInvoice({
    articlesByCode: ARTICOLI,
    contatore: contatore(),
    currentValue: 135,
    fasce: FASCE_STANDARD,
    includeFixedCharge: false,
    lettura: lettura(),
    previousValue: 0,
    ...overrides,
});

const righeConsumo = (risultato) => risultato.lines.filter((riga) => !riga.tipo_quota);
const righeFisse = (risultato) => risultato.lines.filter((riga) => riga.tipo_quota);

test('scaglioni: il consumo viene ripartito sulle fasce con estremi inclusivi', () => {
    const risultato = calcola({ currentValue: 135 });
    const righe = righeConsumo(risultato);

    assert.equal(risultato.billableConsumption, 135);
    assert.equal(righe.length, 2, 'la fascia 151-200 non deve produrre righe');
    assert.deepEqual(righe.map((r) => r.metri_cubi), [100, 35]);
    assert.deepEqual(righe.map((r) => r.valore_unitario), [33, 25.55]);
    assert.equal(risultato.totals.imponibile, 58.55);
});

test('scaglioni: consumo esattamente sul confine della prima fascia', () => {
    const righe = righeConsumo(calcola({ currentValue: 100 }));

    assert.equal(righe.length, 1);
    assert.equal(righe[0].metri_cubi, 100);
});

test('scaglioni: un solo metro cubo oltre il confine apre la fascia successiva', () => {
    const righe = righeConsumo(calcola({ currentValue: 101 }));

    assert.deepEqual(righe.map((r) => r.metri_cubi), [100, 1]);
});

test('scaglioni: il consumo oltre l ultima fascia si ferma al massimo coperto', () => {
    // 300 mc con fasce fino a 200: la copertura e incompleta e il calcolo deve fermarsi
    assert.throws(() => calcola({ currentValue: 300 }), /copre 200 mc su 300 mc/);
});

test('consumo nullo: nessuna riga di consumo e nessun errore', () => {
    const risultato = calcola({ currentValue: 0 });

    assert.equal(risultato.billableConsumption, 0);
    assert.equal(righeConsumo(risultato).length, 0);
    assert.equal(risultato.totals.imponibile, 0);
});

test('contatore sostituito: indice che riparte da zero non genera importi negativi', () => {
    const risultato = calcola({ previousValue: 359, currentValue: 0 });

    assert.equal(risultato.billableConsumption, 0);
    assert.equal(risultato.lines.length, 0);
    assert.equal(risultato.totals.totale_fattura, 0);
});

test('lettura differenziale: si fattura la differenza, non l indice', () => {
    const risultato = calcola({ previousValue: 1000, currentValue: 1050 });

    assert.equal(risultato.previousValue, 1000);
    assert.equal(risultato.currentValue, 1050);
    assert.equal(risultato.billableConsumption, 50);
    assert.equal(righeConsumo(risultato)[0].metri_cubi, 50);
});

test('quota fissa: quantita 1 al prezzo della fascia, marcata come quota', () => {
    const risultato = calcola({ includeFixedCharge: true });
    const fisse = righeFisse(risultato);

    assert.equal(fisse.length, 1);
    assert.equal(fisse[0].metri_cubi, 1);
    assert.equal(fisse[0].valore_unitario, 99);
    assert.equal(fisse[0].tipo_quota, 'Q.Fissa');
    assert.equal(risultato.fixedCharge.applied, true);
    assert.equal(risultato.fixedCharge.total, 99);
});

test('quota fissa esclusa: resta segnalata come disponibile ma non applicata', () => {
    const risultato = calcola({ includeFixedCharge: false });

    assert.equal(righeFisse(risultato).length, 0);
    assert.equal(risultato.fixedCharge.available, true);
    assert.equal(risultato.fixedCharge.applied, false);
    assert.equal(risultato.fixedCharge.estimatedTotal, 99);
    assert.equal(risultato.fixedCharge.total, 0);
});

test('quota fissa senza fasce consumo: e ammessa da sola', () => {
    const soloFissa = FASCE_STANDARD.filter(isFixedBand);
    const risultato = calcola({ fasce: soloFissa, includeFixedCharge: true });

    assert.equal(righeFisse(risultato).length, 1);
    assert.equal(risultato.totals.imponibile, 99);
});

test('listino senza fasce valide: il calcolo si ferma invece di fatturare a zero', () => {
    assert.throws(
        () => calcola({ fasce: [] }),
        /non ha fasce consumo valide/
    );
});

test('validita temporale: una tariffa scaduta resta in vigore finche non ne arriva una nuova', () => {
    // La data di scadenza dice "questo prezzo vale fino a qui", non "dopo di me
    // non si fattura piu": il consiglio approva una tariffa e quella si applica
    // finche non ne delibera un'altra. Senza proroga, il 1 gennaio 2027 la
    // fatturazione si fermerebbe su 1.059 contatori su 1.061.
    const scadute = [
        fascia({ tipo: 'Tariffa Base', min: 1, max: 100, prezzo: 0.33, inizio: '2020-01-01', scadenza: '2020-12-31' }),
    ];
    const righe = righeConsumo(calcola({ fasce: scadute, currentValue: 10 }));

    assert.equal(righe.length, 1);
    assert.equal(righe[0].prezzo, 0.33);
});

test('validita temporale: senza nessuna fascia il calcolo si ferma', () => {
    assert.throws(() => calcola({ fasce: [] }), /non ha fasce consumo valide/);
});

test('validita temporale: una fascia futura non viene prorogata all indietro', () => {
    // Prorogare una tariffa non ancora in vigore vorrebbe dire applicarla prima
    // che sia stata deliberata.
    const future = [
        fascia({ tipo: 'Tariffa Base', min: 1, max: 100, prezzo: 0.5, inizio: '2030-01-01', scadenza: '2030-12-31' }),
    ];

    assert.throws(() => calcola({ fasce: future }), /non ha fasce consumo valide/);
});

test('la proroga riempie solo i buchi, non si sovrappone a una tariffa valida', () => {
    // Il caso reale: quasi tutte le fasce scadono a fine 2026, ma la piu alta
    // resta valida fino al 2099. Prorogare anche quella significherebbe
    // fatturare lo stesso scaglione due volte.
    const fasce = [
        fascia({ tipo: 'Tariffa Base', min: 1, max: 100, prezzo: 0.33, inizio: '2020-01-01', scadenza: '2026-12-31' }),
        fascia({ tipo: 'Ordinaria', min: 101, max: 300, prezzo: 0.73, inizio: '2020-01-01', scadenza: '2026-12-31' }),
        fascia({ tipo: 'Alta', min: 301, max: 9999, prezzo: 1.23, inizio: '2020-01-01', scadenza: '2099-12-31' }),
    ];
    const righe = righeConsumo(calcola({ fasce, lettura: lettura({ data_lettura: new Date('2027-06-15') }), currentValue: 400 }));

    assert.equal(righe.length, 3, 'i tre scaglioni, senza duplicati');
    assert.deepEqual(righe.map((riga) => riga.prezzo), [0.33, 0.73, 1.23]);
    assert.equal(righe.reduce((totale, riga) => totale + riga.metri_cubi, 0), 400);
});

test('la tariffa nuova vince su quella prorogata', () => {
    // Appena si inserisce il prezzo del nuovo anno, la proroga si fa da parte.
    const fasce = [
        fascia({ tipo: 'Tariffa Base', min: 1, max: 100, prezzo: 0.33, inizio: '2020-01-01', scadenza: '2026-12-31' }),
        fascia({ tipo: 'Tariffa Base', min: 1, max: 100, prezzo: 0.40, inizio: '2027-01-01', scadenza: '2027-12-31' }),
    ];
    const righe = righeConsumo(calcola({ fasce, lettura: lettura({ data_lettura: new Date('2027-06-15') }), currentValue: 50 }));

    assert.equal(righe.length, 1);
    assert.equal(righe[0].prezzo, 0.40);
});

test('fra due versioni scadute vale la piu recente', () => {
    const fasce = [
        fascia({ tipo: 'Tariffa Base', min: 1, max: 100, prezzo: 0.20, inizio: '2018-01-01', scadenza: '2019-12-31' }),
        fascia({ tipo: 'Tariffa Base', min: 1, max: 100, prezzo: 0.33, inizio: '2020-01-01', scadenza: '2026-12-31' }),
    ];
    const righe = righeConsumo(calcola({ fasce, lettura: lettura({ data_lettura: new Date('2027-06-15') }), currentValue: 50 }));

    assert.equal(righe.length, 1);
    assert.equal(righe[0].prezzo, 0.33);
});

test('validita temporale: viene scelta la fascia valida alla data della lettura', () => {
    const fasce = [
        fascia({ tipo: 'Tariffa Base', min: 1, max: 1000, prezzo: 1, inizio: '2020-01-01', scadenza: '2020-12-31' }),
        fascia({ tipo: 'Tariffa Base', min: 1, max: 1000, prezzo: 2, inizio: '2026-01-01', scadenza: '2026-12-31' }),
    ];
    const righe = righeConsumo(calcola({ fasce, currentValue: 10 }));

    assert.equal(righe.length, 1);
    assert.equal(righe[0].prezzo, 2, 'deve valere la tariffa in vigore alla data della lettura');
});

test('articolo mancante: il calcolo si ferma invece di emettere righe senza IVA', () => {
    assert.throws(
        () => calcola({ articlesByCode: {} }),
        /Articolo ACQUA mancante/
    );
});

test('contatore condominiale ripartito: usa gli articoli COND e CONDF', () => {
    const condominiale = contatore({
        tipo_contatore: 'Ripartitore condominiale',
        tipo_attivita: 'Utenza condominiale',
    });
    const risultato = calcola({ contatore: condominiale, includeFixedCharge: true });

    assert.equal(righeConsumo(risultato)[0].articolo, ARTICOLI.COND._id);
    assert.equal(righeFisse(risultato)[0].articolo, ARTICOLI.CONDF._id);
});

test('ogni riga conserva lo snapshot del calcolo', () => {
    const riga = righeConsumo(calcola())[0];

    assert.equal(riga.calcolo_snapshot.quota, 'variable');
    assert.equal(riga.calcolo_snapshot.fascia.prezzo, 0.33);
    assert.equal(riga.calcolo_snapshot.listino.categoria, 'DOMESTICO');
    assert.equal(riga.calcolo_snapshot.lettura.valore_precedente, 0);
    assert.equal(riga.calcolo_snapshot.lettura.valore_attuale, 135);
});

test('le righe sono numerate progressivamente da 1', () => {
    const risultato = calcola({ includeFixedCharge: true });

    assert.deepEqual(risultato.lines.map((r) => r.riga), [1, 2, 3]);
});

test('getBandQuantity: il limite inferiore e min - 1', () => {
    const banda = fascia({ tipo: 'Ordinaria', min: 101, max: 150, prezzo: 1 });

    assert.equal(getBandQuantity(100, banda), 0);
    assert.equal(getBandQuantity(101, banda), 1);
    assert.equal(getBandQuantity(150, banda), 50);
    assert.equal(getBandQuantity(999, banda), 50);
});

test('getBandQuantity: max a zero significa nessun limite superiore', () => {
    const banda = fascia({ tipo: 'Ordinaria', min: 1, max: 0, prezzo: 1 });

    assert.equal(getBandQuantity(500, banda), 500);
});

test('getApplicableBands: ordina le fasce fisse in fondo', () => {
    const ordinate = getApplicableBands(FASCE_STANDARD, { listinoId: 'listino-1' });

    assert.equal(isFixedBand(ordinate[ordinate.length - 1]), true);
    assert.deepEqual(ordinate.slice(0, 3).map((b) => b.min), [1, 101, 151]);
});

test('getApplicableBands: esclude le fasce di altri listini', () => {
    const altre = [...FASCE_STANDARD, fascia({ tipo: 'Tariffa Base', min: 1, max: 10, prezzo: 9, listinoId: 'altro' })];
    const ordinate = getApplicableBands(altre, { listinoId: 'listino-1' });

    assert.equal(ordinate.every((b) => b.listino === 'listino-1'), true);
});

test('getTaxRate: legge l aliquota dal testo dell articolo', () => {
    assert.equal(getTaxRate({ iva: 'IVA 10%' }), 10);
    assert.equal(getTaxRate({ iva: 'IVA 22%' }), 22);
    assert.equal(getTaxRate({ iva: 'IVA 4,5%' }), 4.5);
    assert.equal(getTaxRate('IVA 10%'), 10);
});

test('getTaxRate: testi senza percentuale valgono zero', () => {
    assert.equal(getTaxRate({ iva: 'Esente art.15' }), 0);
    assert.equal(getTaxRate({ iva: 'Codice iva Art.26 DPR 633/72 Comma 3°' }), 0);
    assert.equal(getTaxRate({ iva: 'NI90' }), 0);
    assert.equal(getTaxRate(null), 0);
    assert.equal(getTaxRate(undefined), 0);
});

test('calculateTotals: imponibile, IVA e totale su piu aliquote', () => {
    const totali = calculateTotals([
        { valore_unitario: 100, aliquota_iva: 10 },
        { valore_unitario: 50, aliquota_iva: 22 },
        { valore_unitario: 6, aliquota_iva: 0 },
    ]);

    assert.equal(totali.imponibile, 156);
    assert.equal(totali.iva, 21);
    assert.equal(totali.totale_fattura, 177);
});

test('calculateTotals: senza aliquota salvata usa quella dell articolo', () => {
    const totali = calculateTotals([
        { valore_unitario: 200, articolo_dettaglio: { iva: 'IVA 10%' } },
    ]);

    assert.equal(totali.iva, 20);
});

test('calculateTotals: elenco vuoto produce totali a zero', () => {
    assert.deepEqual(calculateTotals([]), { imponibile: 0, iva: 0, totale_fattura: 0 });
});

test("l'IVA si calcola sugli importi di riga arrotondati al centesimo", () => {
    // Il documento dichiara 4,73: la base imponibile e quella, non 4,729527.
    // I riparti condominiali importati hanno importi con sei decimali, e
    // calcolare l'imposta sul valore non arrotondato dava un centesimo in meno
    // su tre fatture. E anche cio che vuole il riepilogo della fattura
    // elettronica, che somma gli importi di riga a due decimali.
    const righe = [
        { valore_unitario: 4.729527, iva_percentuale: 10 },
        { valore_unitario: 11.6655, iva_percentuale: 10 },
    ];
    const totali = calculateTotals(righe);

    assert.equal(totali.imponibile, 16.4, '4,73 + 11,67');
    assert.equal(totali.iva, 1.64);
    assert.equal(totali.totale_fattura, 18.04);
});

test('il totale di una fattura e sempre imponibile piu imposta', () => {
    // Vale su qualunque combinazione di aliquote: e la proprieta su cui il
    // Sistema di Interscambio ricalcola il documento.
    const combinazioni = [
        [{ valore_unitario: 0.01, iva_percentuale: 10 }],
        [{ valore_unitario: 33.33, iva_percentuale: 22 }, { valore_unitario: 6, iva_percentuale: 0 }],
        [{ valore_unitario: 99.99, iva_percentuale: 10 }, { valore_unitario: 0.05, iva_percentuale: 10 }],
    ];

    combinazioni.forEach((righe) => {
        const totali = calculateTotals(righe);
        const somma = Math.round((totali.imponibile + totali.iva) * 100);

        assert.equal(Math.round(totali.totale_fattura * 100), somma);
    });
});
