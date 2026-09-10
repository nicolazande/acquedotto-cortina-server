const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const {
    COLONNE, abbinaLettureAllePrecedenti, creaExcel, creaPdf, creaWord, dataItaliana, rigaDaLettura,
} = require('../services/elencoBim');

// Legge le parti di un pacchetto Office (xlsx e docx sono zip) senza librerie:
// basta scorrere le intestazioni locali, che `creaZip` scrive senza comprimere.
const partiDelPacchetto = (buffer) => {
    const parti = new Map();
    let posizione = 0;

    while (posizione < buffer.length - 4) {
        if (buffer.readUInt32LE(posizione) !== 0x04034b50) break;
        const lunghezzaNome = buffer.readUInt16LE(posizione + 26);
        const lunghezzaExtra = buffer.readUInt16LE(posizione + 28);
        const dimensione = buffer.readUInt32LE(posizione + 18);
        const nome = buffer.toString('utf8', posizione + 30, posizione + 30 + lunghezzaNome);
        const inizio = posizione + 30 + lunghezzaNome + lunghezzaExtra;
        parti.set(nome, buffer.toString('utf8', inizio, inizio + dimensione));
        posizione = inizio + dimensione;
    }

    return parti;
};

const riga = rigaDaLettura({
    lettura: { consumo: 2148, data_lettura: '2026-08-25' },
    letturaPrecedente: { consumo: 2103 },
    contatore: { seriale: '02402485', tipo_attivita: 'DOMESTICO RESIDENTE' },
    cliente: { codice_cliente_erp: '1097', cognome: 'Casanova De Marco', nome: 'Maria Teresa', codice_fiscale: 'CSNMTR42B43A757R' },
    edificio: { indirizzo: 'PIAN DA LAGO' },
});

const opzioni = { anno: 2026, ente: 'COOPERATIVA GESTIONE ACQUEDOTTO VICINIA DI ZUEL' };

test('il consumo e la differenza fra le due letture', () => {
    // E il numero su cui il BIM fattura fognatura e depurazione: sbagliarlo
    // significa far pagare a un utente il consumo di un altro anno.
    assert.equal(riga.letturaAttuale, 2148);
    assert.equal(riga.letturaPrecedente, 2103);
    assert.equal(riga.consumi, 45);
});

test('un contatore letto a ritroso non produce un consumo negativo', () => {
    // Capita con le sostituzioni: il contatore nuovo riparte da zero.
    const dopoSostituzione = rigaDaLettura({
        lettura: { consumo: 12 }, letturaPrecedente: { consumo: 8400 },
        contatore: {}, cliente: {}, edificio: {},
    });

    assert.equal(dopoSostituzione.consumi, 0);
});

test('la quota di riparto segue il contatore condominiale', () => {
    // Su un condominiale il BIM fattura a ciascuno la sua parte: la percentuale
    // e quella del contatore, non sempre cento.
    assert.equal(riga.percentuale, 100);
    assert.equal(rigaDaLettura({
        lettura: {}, letturaPrecedente: {}, contatore: { consumo: 33 }, cliente: {}, edificio: {},
    }).percentuale, 33);
});

test('le date si scrivono come le legge chi riceve l elenco', () => {
    assert.equal(dataItaliana('2026-08-25'), '25/08/2026');
    assert.equal(dataItaliana(null), '');
    assert.equal(dataItaliana('non una data'), '');
});

test('il foglio di calcolo e un pacchetto Office completo', () => {
    const parti = partiDelPacchetto(creaExcel([riga], 'Consumi 2026'));

    ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']
        .forEach((nome) => assert.ok(parti.has(nome), `manca ${nome}`));
});

test('nel foglio i numeri restano numeri, non testo', () => {
    // Chi riceve l'elenco ci fa le somme: un consumo scritto come testo non si
    // somma, e l'errore non si vede finche il totale non torna.
    const foglio = partiDelPacchetto(creaExcel([riga], 'Consumi')).get('xl/worksheets/sheet1.xml');

    assert.match(foglio, /<v>2148<\/v>/);
    assert.match(foglio, /<v>45<\/v>/);
    assert.match(foglio, /Casanova De Marco Maria Teresa/);
});

test('il documento Word dichiara tabella e larghezze', () => {
    // Senza le larghezze delle celle il file e XML valido ma nessun programma
    // lo apre, e l'errore non dice perche.
    const documento = partiDelPacchetto(creaWord([riga], opzioni)).get('word/document.xml');

    assert.match(documento, /<w:tbl>/);
    assert.match(documento, /<w:tcW w:w="\d+" w:type="dxa"\/>/);
    assert.match(documento, /landscape/);
    assert.equal((documento.match(/<w:tr>/g) || []).length, 2, 'una riga di intestazione e una di dati');
});

test('il PDF si apre e contiene i dati', () => {
    const pdf = creaPdf([riga], opzioni);

    assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
    // Orizzontale: dodici colonne su un A4 verticale finirebbero fuori pagina,
    // e le ultime non si vedrebbero affatto.
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 842 595\]/);
    const flussi = [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)];
    const testo = flussi.map((f) => {
        try { return zlib.inflateSync(Buffer.from(f[1], 'latin1')).toString('latin1'); } catch { return f[1]; }
    }).join('');

    assert.match(testo, /Casanova De Marco/);
    assert.match(testo, /Elenco consumi/);
});

test('i tre formati mostrano le stesse colonne', () => {
    // Sono lo stesso elenco: se le colonne divergessero, chi confronta il PDF
    // col foglio di calcolo troverebbe due documenti diversi.
    const foglio = partiDelPacchetto(creaExcel([riga], 'x')).get('xl/worksheets/sheet1.xml');
    const documento = partiDelPacchetto(creaWord([riga], opzioni)).get('word/document.xml');

    COLONNE.forEach(({ titolo }) => {
        const atteso = titolo.replace(/&/g, '&amp;');
        assert.ok(foglio.includes(atteso), `il foglio non ha la colonna ${titolo}`);
        assert.ok(documento.includes(atteso), `il documento non ha la colonna ${titolo}`);
    });
});


// Il caso vero: l'apparecchio 08036108 di Pian da Lago, letto da tre intestatari
// che si sono succeduti. Ogni cambio di intestatario crea un contatore nuovo,
// ma l'apparecchio e sempre quello e l'indice non riparte da zero.
const subentroReale = {
    letture: [
        {
            _id: 'l-uscente', consumo: 690, data_lettura: '2026-04-27',
            contatore: { _id: 'c-uscente', seriale: '08036108', cliente: { cognome: 'Siorpaes', nome: 'Monica' } },
        },
        {
            _id: 'l-subentrante', consumo: 690, data_lettura: '2026-04-27',
            contatore: { _id: 'c-subentrante', seriale: '08036108', cliente: { cognome: 'Guaitani', nome: 'Umberto' } },
        },
    ],
    anteriori: [
        { contatore: 'c-cessato', consumo: 576, data_lettura: '2022-11-09' },
        { contatore: 'c-uscente', consumo: 674, data_lettura: '2025-11-04' },
    ],
    apparecchioDelContatore: new Map([
        ['c-cessato', 'seriale:08036108'],
        ['c-uscente', 'seriale:08036108'],
        ['c-subentrante', 'seriale:08036108'],
    ]),
};

test('chi subentra non paga il consumo di chi c era prima', () => {
    // Cercando la lettura precedente sul contatore invece che sull apparecchio,
    // il subentrante partirebbe da zero e si vedrebbe addebitare tutto lo
    // storico: sull archivio di oggi sarebbero decine di migliaia di mc.
    const [uscente, subentrante] = abbinaLettureAllePrecedenti(subentroReale);

    assert.equal(uscente.consumi, 16, 'a chi esce i mc fatti nell anno');
    assert.equal(subentrante.letturaPrecedente, 690, 'chi entra parte dall indice trovato');
    assert.equal(subentrante.consumi, 0, 'e non dai 690 mc di chi c era prima');
});

test('un contatore nuovo parte davvero da zero', () => {
    // Il primo impianto e indistinguibile da un subentro se non si guarda se
    // sull apparecchio esistono letture anteriori. Qui non ce ne sono.
    const [riga] = abbinaLettureAllePrecedenti({
        letture: [{ _id: 'l1', consumo: 2561, contatore: { _id: 'c1', seriale: 'KF-25520389' } }],
        anteriori: [],
        apparecchioDelContatore: new Map([['c1', 'seriale:KF-25520389']]),
    });

    assert.equal(riga.letturaPrecedente, 0);
    assert.equal(riga.consumi, 2561);
});

test('due apparecchi diversi non si scambiano le letture', () => {
    const righe = abbinaLettureAllePrecedenti({
        letture: [
            { _id: 'a2', consumo: 120, contatore: { _id: 'ca', seriale: 'AAA' } },
            { _id: 'b2', consumo: 300, contatore: { _id: 'cb', seriale: 'BBB' } },
        ],
        anteriori: [
            { contatore: 'ca', consumo: 100 },
            { contatore: 'cb', consumo: 250 },
        ],
        apparecchioDelContatore: new Map([['ca', 'seriale:AAA'], ['cb', 'seriale:BBB']]),
    });

    assert.deepEqual(righe.map((r) => r.consumi), [20, 50]);
});

test('senza seriale si ricade sul singolo contatore', () => {
    // Qualche record storico non ha il seriale. Li non si puo riconoscere un
    // subentro, ma la lettura precedente dello stesso contatore va comunque
    // trovata, e non deve finire su un contatore diverso.
    const righe = abbinaLettureAllePrecedenti({
        letture: [
            { _id: 'x', consumo: 50, contatore: { _id: 'cx' } },
            { _id: 'y', consumo: 80, contatore: { _id: 'cy' } },
        ],
        anteriori: [{ contatore: 'cx', consumo: 30 }],
        apparecchioDelContatore: new Map([['cx', 'contatore:cx'], ['cy', 'contatore:cy']]),
    });

    assert.equal(righe[0].consumi, 20, 'la propria anteriore si abbina lo stesso');
    assert.equal(righe[1].consumi, 80, 'ma non passa al contatore accanto');
});

test('nel PDF un testo lungo viene troncato, non lasciato sbordare', () => {
    // Le celle non mandano a capo: senza troncatura una ragione sociale lunga
    // si stampa sopra la colonna accanto.
    const lunga = rigaDaLettura({
        lettura: { consumo: 10 }, letturaPrecedente: { consumo: 0 },
        contatore: {}, edificio: {},
        cliente: { ragione_sociale: 'Bar Al Trampolino di Bigontina Carmen & C. Snc con altre parole ancora' },
    });
    const testo = creaPdf([lunga], opzioni).toString('latin1');

    assert.ok(!testo.includes('con altre parole ancora'), 'la coda va tagliata');
    assert.match(testo, /Bigontina[^)]*\.\.\./, 'e sostituita da puntini di sospensione');
});
