const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
    CAMPI, LUNGHEZZA_RIGA, componiRiga, rigaUtenza,
} = require('../services/elencoUfficioEntrate');

// Il file vero prodotto dal gestionale precedente: quindici righe da 1798
// caratteri piu il separatore. E il riferimento su cui il tracciato e stato
// decodificato, campo per campo.
const RIGHE_DI_GESCO = (() => {
    const dati = readFileSync(join(__dirname, 'riferimento-ufficio-entrate.txt'));
    const passo = LUNGHEZZA_RIGA + 2;
    return Array.from(
        { length: dati.length / passo },
        (_, i) => dati.slice(i * passo, (i + 1) * passo - 2).toString('latin1')
    );
})();

const campo = (riga, nome) => riga.slice(...CAMPI[nome]);

test('ogni riga del tracciato e lunga esattamente quanto deve', () => {
    // Un carattere in piu o in meno sposta tutti i campi che seguono, e chi
    // riceve il file legge dati a caso senza accorgersene.
    assert.equal(componiRiga({ tipoRecord: '1' }).length, LUNGHEZZA_RIGA);
    RIGHE_DI_GESCO.forEach((riga, n) => {
        assert.equal(riga.length, LUNGHEZZA_RIGA, `la riga ${n} del file di riferimento`);
    });
});

// Un'utenza qualsiasi, su cui cambiare una cosa per volta.
const utenza = (modifiche = {}) => ({
    cliente: {
        cognome: 'Siorpaes', nome: 'Monica', codice_fiscale: 'SRPMNC64D45G642J',
        sesso: 'Femmina', data_nascita: '1964-04-05', comune_nascita: 'Pieve di Cadore',
        provincia_nascita: 'Belluno', localita_residenza: 'Rovere Veronese',
    },
    contatore: { codice: 939, tipo_attivita: 'DOMESTICO NON RESIDENTE', inizio: '2023-03-17' },
    edificio: { indirizzo: 'PIAN DA LAGO', catasto: 'A266', foglio: '91', ped: '2451', estensione: '0' },
    nuova: false,
    consumo: 16,
    consumoPrecedente: 5,
    ...modifiche,
});

test('il tipo di utenza dice che uso si fa dell acqua', () => {
    // Prima cifra: 1 residenti, 2 non residenti, 3 attivita. Non e la partita
    // IVA a deciderlo - Guaitani non ne ha e sta fra le attivita, perche il suo
    // contatore e PRODUTTIVO.
    const tipo = (attivita) => campo(rigaUtenza(utenza({
        contatore: { codice: 1, tipo_attivita: attivita },
    })), 'tipoUtenza');

    assert.equal(tipo('DOMESTICO RESIDENTE'), '11');
    assert.equal(tipo('DOMESTICO NON RESIDENTE'), '21');
    assert.equal(tipo('PRODUTTIVO'), '31');
    assert.equal(tipo('CANTIERI'), '31');
    assert.equal(tipo('UTENZA CONDOMINIALE'), '31');
});

test('la seconda cifra segnala l utenza nuova dell anno', () => {
    const nuova = (attivita) => campo(rigaUtenza(utenza({
        contatore: { codice: 1, tipo_attivita: attivita, inizio: '2026-04-27' },
        nuova: true,
    })), 'tipoUtenza');

    assert.equal(nuova('DOMESTICO RESIDENTE'), '12');
    assert.equal(nuova('DOMESTICO NON RESIDENTE'), '22');
    assert.equal(nuova('PRODUTTIVO'), '32');
});

test('i mesi di fornitura contano intero il mese in cui si comincia', () => {
    // Chi subentra il 27 aprile ha nove mesi, da aprile a dicembre. La "E"
    // marca la posizione come nuova: sulle altre ci sono i dodici mesi pieni.
    const mesi = (inizio) => campo(rigaUtenza(utenza({
        contatore: { codice: 1, tipo_attivita: 'PRODUTTIVO', inizio },
        nuova: true,
    })), 'mesi');

    assert.equal(mesi('2026-04-27'), 'E 9');
    assert.equal(mesi('2026-07-14'), 'E 6');
    assert.equal(mesi('2026-08-05'), 'E 5');
    assert.equal(mesi('2026-01-01'), 'E12');
    assert.equal(campo(rigaUtenza(utenza()), 'mesi'), ' 12', 'un utenza gia in essere ha l anno intero');
});

test('i dati catastali accompagnano solo le utenze nuove', () => {
    // Per le vecchie l'Anagrafe vuole i soli consumi: e quello che ha chiesto
    // l'acquedotto, ed e come faceva il gestionale precedente.
    const vecchia = rigaUtenza(utenza());
    assert.equal(campo(vecchia, 'foglio').trim(), '');
    assert.equal(campo(vecchia, 'particella').trim(), '');

    const nuova = rigaUtenza(utenza({ nuova: true }));
    assert.equal(campo(nuova, 'foglio').trim(), '91');
    assert.equal(campo(nuova, 'particella').trim(), '2451');
    assert.equal(campo(nuova, 'subalterno').trim(), '0');
});

test('un utenza nuova non dichiara consumi', () => {
    // Il primo anno non ha una lettura precedente da confrontare: il gestionale
    // precedente ci scriveva zero in entrambi i campi.
    const nuova = rigaUtenza(utenza({ nuova: true, consumo: 999, consumoPrecedente: 888 }));

    assert.equal(Number(campo(nuova, 'consumo')), 0);
    assert.equal(Number(campo(nuova, 'consumoPrecedente')), 0);
    assert.equal(campo(nuova, 'dataLettura').trim(), '17032023', 'e porta la data di inizio');
});

test('una societa mette la ragione sociale dove la persona ha il cognome', () => {
    const societa = rigaUtenza(utenza({
        cliente: {
            ragione_sociale: 'IMPRESA EDILE ALFARE SRL', partita_iva: '01241220258',
            localita_residenza: "CORTINA D'AMPEZZO", provincia_residenza: 'Belluno',
        },
        contatore: { codice: 1069, tipo_attivita: 'CANTIERI' },
    }));

    assert.equal(campo(societa, 'codiceFiscale').trim(), '01241220258');
    assert.match(campo(societa, 'ragioneSociale'), /IMPRESA EDILE ALFARE SRL/);
    assert.equal(campo(societa, 'cognome').trim(), '', 'il cognome resta vuoto');
});

test('il codice utenza e "1" seguito dal codice del contatore', () => {
    assert.equal(campo(rigaUtenza(utenza()), 'codiceUtenza').trim(), '1939');
});

test('le righe generate combaciano con quelle del gestionale precedente', () => {
    // Si ricostruisce una riga vera partendo dai suoi stessi dati: se il
    // tracciato e letto bene, i campi che dipendono dal tracciato - non dai dati
    // in archivio - devono tornare identici.
    const vera = RIGHE_DI_GESCO.find((r) => r.slice(1, 17).trim() === 'SRPMNC64D45G642J');
    const mia = rigaUtenza(utenza());

    ['tipoRecord', 'codiceFiscale', 'cognome', 'nome', 'sesso', 'codiceUtenza',
        'tipoUtenza', 'indirizzo', 'codiceCatastale', 'tipoFornitura', 'mesi',
        'consumo', 'consumoPrecedente', 'fine'].forEach((nome) => {
        assert.equal(campo(mia, nome), campo(vera, nome), `il campo ${nome}`);
    });
});
