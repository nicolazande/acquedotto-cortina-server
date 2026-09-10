const test = require('node:test');
const assert = require('node:assert/strict');

const { NOMI_ELENCHI, getElenco } = require('../services/registroElenchi');
const { creaExcel, creaPdf, creaWord } = require('../services/tabellaStampabile');

// Il registro e il punto in cui si aggiunge un elenco nuovo. Se una voce e
// incompleta il difetto si vede solo quando qualcuno prova a scaricarlo, e a
// quel punto e un 500 in faccia a chi lo aspettava.
test('ogni elenco dichiara tutto quello che serve a produrlo', () => {
    assert.ok(NOMI_ELENCHI.length > 0, 'il registro non puo essere vuoto');

    NOMI_ELENCHI.forEach((nome) => {
        const elenco = getElenco(nome);

        assert.equal(typeof elenco.etichetta, 'string', `${nome}: manca l'etichetta`);
        assert.equal(typeof elenco.nomeFile, 'function', `${nome}: manca il nome del file`);
        assert.equal(typeof elenco.titolo, 'function', `${nome}: manca il titolo`);
        assert.equal(typeof elenco.righe, 'function', `${nome}: manca chi produce le righe`);
        assert.equal(typeof elenco.riepilogo, 'function', `${nome}: manca il riepilogo`);
        assert.ok(Array.isArray(elenco.colonne) && elenco.colonne.length > 0, `${nome}: manca le colonne`);
    });
});

test('le colonne sono descritte come i tre formati si aspettano', () => {
    NOMI_ELENCHI.forEach((nome) => {
        getElenco(nome).colonne.forEach((colonna, indice) => {
            assert.equal(typeof colonna.titolo, 'string', `${nome}, colonna ${indice}: manca il titolo`);
            assert.equal(typeof colonna.campo, 'string', `${nome}, colonna ${indice}: manca il campo`);
            assert.ok(
                Number.isFinite(colonna.larghezza) && colonna.larghezza > 0,
                `${nome}, colonna ${indice}: la larghezza deve essere un peso positivo`
            );
        });
    });
});

test('il nome del file e il titolo portano dentro l anno', () => {
    // Chi riceve tre elenchi di tre anni diversi deve distinguerli dal nome,
    // senza aprirli.
    NOMI_ELENCHI.forEach((nome) => {
        const elenco = getElenco(nome);

        assert.match(elenco.nomeFile(2025), /2025/, `${nome}: il nome del file non dice l'anno`);
        assert.notEqual(elenco.nomeFile(2025), elenco.nomeFile(2024));
        assert.match(elenco.titolo(2025), /2025/, `${nome}: il titolo non dice l'anno`);
    });
});

test('un elenco che non esiste non e un elenco vuoto', () => {
    // Deve tornare undefined, cosi il controller risponde 404 invece di
    // produrre un file senza righe che sembra buono.
    assert.equal(getElenco('non-esiste'), undefined);
    assert.equal(getElenco(''), undefined);
});

test('ogni elenco del registro si stampa nei tre formati', () => {
    // La prova che registro e stampa parlano la stessa lingua: con una riga
    // finta, i tre formati devono produrre un file valido.
    NOMI_ELENCHI.forEach((nome) => {
        const { colonne, titolo } = getElenco(nome);
        const riga = Object.fromEntries(colonne.map((c) => [c.campo, c.numero ? 1 : 'x']));
        const opzioni = { anno: 2025, ente: 'Ente di prova' };

        assert.equal(creaExcel(colonne, [riga], titolo(2025)).slice(0, 2).toString(), 'PK', `${nome}: Excel`);
        assert.equal(creaWord(colonne, [riga], opzioni).slice(0, 2).toString(), 'PK', `${nome}: Word`);
        assert.equal(creaPdf(colonne, [riga], opzioni).slice(0, 5).toString(), '%PDF-', `${nome}: PDF`);
    });
});
