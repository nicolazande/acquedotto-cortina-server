const test = require('node:test');
const assert = require('node:assert/strict');

const { NOMI_ELENCHI, getElenco } = require('../services/registroElenchi');
const { creaExcel, creaPdf, creaWord } = require('../services/tabellaStampabile');

// Il registro e il punto in cui si aggiunge un elenco nuovo. Se una voce e
// incompleta il difetto si vede solo quando qualcuno prova a scaricarlo, e a
// quel punto e un 500 in faccia a chi lo aspettava.
// Ci sono due specie di elenco: quelli che sono una tabella - colonne e righe,
// stampabili in Excel, PDF e Word - e quelli che sono un tracciato deciso da chi
// li riceve, come l'Anagrafe Tributaria, che hanno un testo gia pronto.
const tabellari = () => NOMI_ELENCHI.filter((nome) => !getElenco(nome).testo);
const aTracciato = () => NOMI_ELENCHI.filter((nome) => getElenco(nome).testo);

test('ogni elenco dichiara tutto quello che serve a produrlo', () => {
    assert.ok(NOMI_ELENCHI.length > 0, 'il registro non puo essere vuoto');

    NOMI_ELENCHI.forEach((nome) => {
        const elenco = getElenco(nome);

        assert.equal(typeof elenco.etichetta, 'string', `${nome}: manca l'etichetta`);
        assert.equal(typeof elenco.nomeFile, 'function', `${nome}: manca il nome del file`);
        assert.equal(typeof elenco.titolo, 'function', `${nome}: manca il titolo`);
        assert.equal(typeof elenco.riepilogo, 'function', `${nome}: manca il riepilogo`);

        // O l'uno o l'altro, mai tutti e due e mai nessuno: il controller
        // sceglie cosa produrre guardando quale dei due c'e.
        const eTabella = Array.isArray(elenco.colonne) && elenco.colonne.length > 0;
        const eTracciato = typeof elenco.testo === 'function';
        assert.ok(
            eTabella !== eTracciato,
            `${nome}: deve avere le colonne (tabella) oppure il testo (tracciato), non entrambi`
        );

        if (eTabella) {
            assert.equal(typeof elenco.righe, 'function', `${nome}: manca chi produce le righe`);
        }
    });
});

test('le colonne sono descritte come i tre formati si aspettano', () => {
    tabellari().forEach((nome) => {
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

test('ogni elenco tabellare del registro si stampa nei tre formati', () => {
    // La prova che registro e stampa parlano la stessa lingua: con una riga
    // finta, i tre formati devono produrre un file valido.
    tabellari().forEach((nome) => {
        const { colonne, titolo } = getElenco(nome);
        const riga = Object.fromEntries(colonne.map((c) => [c.campo, c.numero ? 1 : 'x']));
        const opzioni = { anno: 2025, ente: 'Ente di prova' };

        assert.equal(creaExcel(colonne, [riga], titolo(2025)).slice(0, 2).toString(), 'PK', `${nome}: Excel`);
        assert.equal(creaWord(colonne, [riga], opzioni).slice(0, 2).toString(), 'PK', `${nome}: Word`);
        assert.equal(creaPdf(colonne, [riga], opzioni).slice(0, 5).toString(), '%PDF-', `${nome}: PDF`);
    });
});


test('gli elenchi a tracciato producono un testo, non una tabella', () => {
    // Chi riceve un tracciato ha deciso lui come e fatto il file: non si
    // impagina, si scrive com'e.
    aTracciato().forEach((nome) => {
        const elenco = getElenco(nome);

        assert.equal(typeof elenco.testo, 'function', `${nome}: manca chi produce il testo`);
        assert.equal(elenco.colonne, undefined, `${nome}: un tracciato non ha colonne`);
        assert.equal(elenco.righe, undefined, `${nome}: un tracciato non ha righe da impaginare`);
    });
});
