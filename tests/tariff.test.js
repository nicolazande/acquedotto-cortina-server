const test = require('node:test');
const assert = require('node:assert/strict');

const { analizzaCopertura, pianoRinnovo, prezzoRinnovato } = require('../services/tariffService');

const fascia = (tipo, min, max, prezzo, inizio = '1900-01-01', scadenza = '2026-12-31') => ({
    _id: `${tipo}-${min}`, tipo, min, max, prezzo,
    inizio: new Date(inizio), scadenza: new Date(scadenza), listino: 'listino-1',
});

// Il listino reale piu insidioso: quattro fasce scadono a fine 2026, la piu alta
// resta valida fino al 2099. Duplicare anche quella creerebbe una
// sovrapposizione, cioe una doppia fatturazione dello stesso scaglione.
const DOMESTICO_NON_RESIDENTE = [
    fascia('Fisso', 0, 99999.99, 99),
    fascia('Tariffa Base', 1, 100, 0.33),
    fascia('Ordinaria', 101, 150, 0.73),
    fascia('1° Supero', 151, 200, 0.83),
    fascia('2° Supero', 201, 300, 1.19),
    fascia('Tariffa Base alta', 301, 9999, 1.23, '1900-01-01', '2099-12-31'),
];

// --- copertura ---------------------------------------------------------------

test('un listino completo non ha problemi di copertura', () => {
    const esito = analizzaCopertura(DOMESTICO_NON_RESIDENTE, new Date('2026-06-15'));

    assert.deepEqual(esito.problemi, []);
    assert.equal(esito.tetto, 9999);
});

test('un buco fra due scaglioni viene detto con i suoi estremi', () => {
    const conBuco = DOMESTICO_NON_RESIDENTE.filter((f) => f.tipo !== 'Ordinaria');
    const esito = analizzaCopertura(conBuco, new Date('2026-06-15'));

    assert.equal(esito.problemi.length, 1);
    assert.match(esito.problemi[0], /Fra 100 e 151 mc non c'è tariffa/);
});

test('due fasce che si sovrappongono verrebbero fatturate due volte', () => {
    const sovrapposte = [...DOMESTICO_NON_RESIDENTE, fascia('Doppione', 120, 180, 0.9)];
    const esito = analizzaCopertura(sovrapposte, new Date('2026-06-15'));

    assert.ok(esito.problemi.some((p) => /si sovrappongono/.test(p)));
});

test('se manca il primo scaglione lo dice, invece di fatturare da meta', () => {
    const senzaBase = DOMESTICO_NON_RESIDENTE.filter((f) => f.tipo !== 'Tariffa Base');
    const esito = analizzaCopertura(senzaBase, new Date('2026-06-15'));

    assert.match(esito.problemi[0], /I primi 100 mc non hanno tariffa/);
});

test('dopo la scadenza non resta nulla su cui calcolare', () => {
    const esito = analizzaCopertura(DOMESTICO_NON_RESIDENTE, new Date('2027-01-15'));

    // Resta solo la fascia alta: il consumo sotto i 301 mc non ha prezzo.
    assert.match(esito.problemi[0], /I primi 300 mc non hanno tariffa/);
});

// --- prezzo ------------------------------------------------------------------

test('il prezzo rinnovato passa dai centesimi interi', () => {
    assert.equal(prezzoRinnovato(0.33, 0), 0.33);
    assert.equal(prezzoRinnovato(0.33, 10), 0.36, '33 centesimi + 10% = 36,3 -> 36');
    assert.equal(prezzoRinnovato(99, 2.5), 101.48, '9900 + 2,5% = 10147,5 -> 10148');
    assert.equal(prezzoRinnovato(0.33, -10), 0.3);
});

// --- piano di rinnovo --------------------------------------------------------

test('rinnova solo le fasce che scadono, non quelle gia valide', () => {
    const piano = pianoRinnovo({ fasce: DOMESTICO_NON_RESIDENTE, anno: 2027 });

    assert.equal(piano.nuove.length, 5, 'le cinque che scadono a fine 2026');
    assert.equal(piano.giaValide.length, 1);
    assert.equal(piano.giaValide[0].tipo, 'Tariffa Base alta');
    assert.ok(!piano.nuove.some((f) => f.tipo === 'Tariffa Base alta'), 'duplicarla sarebbe una sovrapposizione');
});

test('le nuove fasce coprono esattamente l anno indicato', () => {
    const piano = pianoRinnovo({ fasce: DOMESTICO_NON_RESIDENTE, anno: 2027 });

    piano.nuove.forEach((f) => {
        assert.equal(f.inizio.toISOString().slice(0, 10), '2027-01-01');
        assert.equal(f.scadenza.toISOString().slice(0, 10), '2027-12-31');
    });
});

test('il piano risultante non lascia buchi, e lo dichiara', () => {
    const piano = pianoRinnovo({ fasce: DOMESTICO_NON_RESIDENTE, anno: 2027 });

    assert.deepEqual(piano.problemi, []);
    assert.equal(piano.applicabile, true);
});

test('un rinnovo che lascerebbe un buco non e applicabile', () => {
    // Senza lo scaglione 101-150 il rinnovo produrrebbe un listino rotto:
    // meglio saperlo prima di crearlo che il giorno in cui si fattura.
    const conBuco = DOMESTICO_NON_RESIDENTE.filter((f) => f.tipo !== 'Ordinaria');
    const piano = pianoRinnovo({ fasce: conBuco, anno: 2027 });

    assert.equal(piano.applicabile, false);
    assert.ok(piano.problemi.length > 0);
});

test('la variazione si applica a tutte le fasce rinnovate', () => {
    const piano = pianoRinnovo({ fasce: DOMESTICO_NON_RESIDENTE, anno: 2027, variazione: 5 });

    const base = piano.nuove.find((f) => f.tipo === 'Tariffa Base');
    assert.equal(base.prezzoPrecedente, 0.33);
    assert.equal(base.prezzo, 0.35, '33 centesimi + 5% = 34,65 -> 35');
    assert.equal(piano.variazione, 5);
});

test('rinnovare un anno gia coperto non produce nulla da fare', () => {
    const gia2027 = DOMESTICO_NON_RESIDENTE.map((f) => ({ ...f, scadenza: new Date('2027-12-31') }));
    const piano = pianoRinnovo({ fasce: gia2027, anno: 2027 });

    assert.equal(piano.nuove.length, 0);
    assert.equal(piano.applicabile, false);
});

test('la quota fissa viene rinnovata come le altre', () => {
    const piano = pianoRinnovo({ fasce: DOMESTICO_NON_RESIDENTE, anno: 2027 });

    assert.ok(piano.nuove.some((f) => f.tipo === 'Fisso' && f.prezzo === 99));
});

test('un listino scaduto da anni si rinnova dalle sue ultime tariffe', () => {
    // Nei dati reali un listino era scaduto il 31/12/2023 senza che nessuno se
    // ne accorgesse. Se il rinnovo guardasse solo alla vigilia dell'anno di
    // destinazione non troverebbe nulla da copiare, e resterebbe scoperto
    // proprio il caso in cui serve.
    const scadutoNel2023 = DOMESTICO_NON_RESIDENTE
        .filter((f) => f.tipo !== 'Tariffa Base alta')
        .map((f) => ({ ...f, scadenza: new Date('2023-12-31') }));
    const piano = pianoRinnovo({ fasce: scadutoNel2023, anno: 2027 });

    assert.equal(piano.nuove.length, 5);
    assert.deepEqual(piano.problemi, []);
    assert.equal(piano.applicabile, true);
});

test('un listino senza alcuna fascia non si inventa tariffe', () => {
    const piano = pianoRinnovo({ fasce: [], anno: 2027 });

    assert.equal(piano.nuove.length, 0);
    assert.equal(piano.applicabile, false);
});
