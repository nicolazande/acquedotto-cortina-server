const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
    COLONNE, abbinaLettureAllePrecedenti, ordinaPerSubentro, riepilogoDelleRighe, rigaDaLettura,
} = require('../services/elencoBim');
const { creaExcel, creaPdf, creaWord, perLaCella } = require('../services/tabellaStampabile');
const { formatItalianDate } = require('../utils/dates');
const { larghezzaDelTesto } = require('../services/invoicePdf');

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
    assert.equal(formatItalianDate('2026-08-25'), '25/08/2026');
    assert.equal(formatItalianDate(null), '');
    assert.equal(formatItalianDate('non una data'), '');
});

test('il foglio di calcolo e un pacchetto Office completo', () => {
    const parti = partiDelPacchetto(creaExcel(COLONNE, [riga], 'Consumi 2026'));

    ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']
        .forEach((nome) => assert.ok(parti.has(nome), `manca ${nome}`));
});

test('nel foglio i numeri restano numeri, non testo', () => {
    // Chi riceve l'elenco ci fa le somme: un consumo scritto come testo non si
    // somma, e l'errore non si vede finche il totale non torna.
    const foglio = partiDelPacchetto(creaExcel(COLONNE, [riga], 'Consumi')).get('xl/worksheets/sheet1.xml');

    assert.match(foglio, /<v>2148<\/v>/);
    assert.match(foglio, /<v>45<\/v>/);
    assert.match(foglio, /Casanova De Marco Maria Teresa/);
});

test('il documento Word dichiara tabella e larghezze', () => {
    // Senza le larghezze delle celle il file e XML valido ma nessun programma
    // lo apre, e l'errore non dice perche.
    const documento = partiDelPacchetto(creaWord(COLONNE, [riga], opzioni)).get('word/document.xml');

    assert.match(documento, /<w:tbl>/);
    assert.match(documento, /<w:tcW w:w="\d+" w:type="dxa"\/>/);
    assert.match(documento, /landscape/);
    assert.equal((documento.match(/<w:tr>/g) || []).length, 2, 'una riga di intestazione e una di dati');
});

test('la tabella Word sta dentro il foglio', () => {
    // Word non avvisa: una tabella piu larga della pagina la stampa tagliata, e
    // le ultime colonne semplicemente non si vedono. Le larghezze sono le stesse
    // del PDF, quindi basta ritoccarne una perche qui non torni piu.
    const documento = partiDelPacchetto(creaWord(COLONNE, [riga], opzioni)).get('word/document.xml');

    const pagina = Number(documento.match(/<w:pgSz w:w="(\d+)"/)[1]);
    const margine = Number(documento.match(/<w:pgMar w:top="(\d+)"/)[1]);
    const celle = [...documento.matchAll(/<w:tcW w:w="(\d+)"/g)].map((m) => Number(m[1]));
    const primaRiga = celle.slice(0, COLONNE.length);
    const somma = primaRiga.reduce((totale, larghezza) => totale + larghezza, 0);

    assert.equal(primaRiga.length, COLONNE.length);
    assert.ok(
        somma <= pagina - margine * 2,
        `la tabella misura ${somma} twips, il foglio ne ha ${pagina - margine * 2}`
    );
});

test('il PDF si apre e contiene i dati', () => {
    const pdf = creaPdf(COLONNE, [riga], opzioni);

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
    const foglio = partiDelPacchetto(creaExcel(COLONNE, [riga], 'x')).get('xl/worksheets/sheet1.xml');
    const documento = partiDelPacchetto(creaWord(COLONNE, [riga], opzioni)).get('word/document.xml');

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
    const testo = creaPdf(COLONNE, [lunga], opzioni).toString('latin1');

    assert.ok(!testo.includes('con altre parole ancora'), 'la coda va tagliata');
    assert.match(testo, /Bigontina[^)]*\.\.\./, 'e sostituita da puntini di sospensione');
});


// Il riepilogo mostrato prima di scaricare l'elenco.
const righeDiProva = [
    rigaDaLettura({
        lettura: { consumo: 100, data_lettura: '2025-11-04' }, letturaPrecedente: { consumo: 60 },
        contatore: { seriale: 'A' }, edificio: {},
        cliente: { cognome: 'Rossi', nome: 'Mario', codice_fiscale: 'RSSMRA80A01H501U' },
    }),
    rigaDaLettura({
        lettura: { consumo: 40, data_lettura: '2025-01-09' }, letturaPrecedente: { consumo: 40 },
        contatore: { seriale: 'B' }, edificio: {},
        cliente: { ragione_sociale: 'Impresa srl', partita_iva: '01241220258' },
    }),
    rigaDaLettura({
        lettura: { consumo: 25, data_lettura: '2025-06-30' }, letturaPrecedente: undefined,
        contatore: { seriale: 'C' }, edificio: {},
        cliente: { cognome: 'Senza', nome: 'Codice' },
    }),
];

test('il riepilogo conta le utenze e somma i metri cubi', () => {
    const riepilogo = riepilogoDelleRighe(2025, righeDiProva);

    assert.equal(riepilogo.anno, 2025);
    assert.equal(riepilogo.utenze, 3);
    assert.equal(riepilogo.consumi, 65, '40 + 0 + 25');
});

test('il periodo va dalla lettura piu vecchia alla piu recente', () => {
    // Le date scritte in giorno/mese/anno, ordinate come testo, danno il
    // contrario del calendario: "01/11" verrebbe prima di "31/10".
    const riepilogo = riepilogoDelleRighe(2025, righeDiProva);

    assert.equal(riepilogo.dallaLettura, '09/01/2025');
    assert.equal(riepilogo.allaLettura, '04/11/2025');
});

test('il riepilogo segnala cosa guardare prima di mandare l elenco', () => {
    const riepilogo = riepilogoDelleRighe(2025, righeDiProva);

    assert.equal(riepilogo.senzaCodiceFiscale, 1, 'la partita IVA basta, la sua assenza no');
    assert.equal(riepilogo.senzaConsumo, 1);
    assert.equal(riepilogo.primaLettura, 1, 'chi non ha una lettura precedente');
});

test('un anno senza letture non inventa un periodo', () => {
    // La pagina ci si appoggia per dire "non c'e niente da mandare": una data
    // inventata o un "Invalid Date" la farebbero sembrare piena.
    const riepilogo = riepilogoDelleRighe(2019, []);

    assert.equal(riepilogo.utenze, 0);
    assert.equal(riepilogo.consumi, 0);
    assert.equal(riepilogo.dallaLettura, '');
    assert.equal(riepilogo.allaLettura, '');
});


test('nessun testo esce dalla colonna che gli spetta', () => {
    // Il difetto che si vedeva sul PDF vero: il codice fiscale, tutto maiuscole
    // e cifre, occupa un terzo in piu di un nome della stessa lunghezza. Contato
    // a caratteri stava dentro, misurato no, e finiva appoggiato alla partita
    // IVA della colonna accanto.
    const CORPO = 6.5;
    const GRONDA = 10;
    const LARGHEZZA = 842;
    const MARGINE = 24;
    const scala = (LARGHEZZA - MARGINE * 2) / COLONNE.reduce((somma, c) => somma + c.larghezza, 0);

    const riga = rigaDaLettura({
        lettura: { consumo: 100, data_lettura: '2025-11-04' },
        letturaPrecedente: { consumo: 60 },
        contatore: { seriale: 'AC00265407fisso2', tipo_attivita: 'DOMESTICO NON RESIDENTE' },
        edificio: { indirizzo: "Localita' Acquabona" },
        cliente: {
            ragione_sociale: 'Pompanin geom. Enrico Studio tecnico',
            codice_fiscale: 'PMPNRC73T19A266T',
            partita_iva: '00874840259',
            codice_cliente_erp: '1238',
        },
    });

    COLONNE.forEach((colonna, indice) => {
        const disponibile = (colonna.larghezza * scala) - GRONDA;

        assert.ok(
            larghezzaDelTesto(colonna.titolo, CORPO) <= disponibile,
            `il titolo "${colonna.titolo}" non entra nella sua colonna`
        );

        const scritto = perLaCella(riga[colonna.campo], colonna.larghezza * scala, CORPO);
        assert.ok(
            larghezzaDelTesto(scritto, CORPO) <= disponibile,
            `"${scritto}" esce dalla colonna ${colonna.titolo} (indice ${indice})`
        );

        // E non deve nemmeno aver bisogno di troncare: un dato normale ci sta
        // per intero. Senza questa, il troncamento nasconderebbe una colonna
        // troppo stretta e il test passerebbe lo stesso.
        assert.equal(
            scritto,
            String(riga[colonna.campo] ?? ''),
            `la colonna ${colonna.titolo} e troppo stretta per un valore normale`
        );
    });
});

test('un codice fiscale non entra dove entrerebbe un nome della stessa lunghezza', () => {
    // La prova che il conteggio a caratteri non basta: stessa lunghezza,
    // larghezza diversa di un terzo.
    const codice = larghezzaDelTesto('PMPNRC73T19A266T', 6.5);
    const nome = larghezzaDelTesto('Pompanin geom. E', 6.5);

    assert.equal('PMPNRC73T19A266T'.length, 'Pompanin geom. E'.length);
    assert.ok(codice > nome * 1.15, `il codice misura ${codice.toFixed(1)}pt, il nome ${nome.toFixed(1)}pt`);
});


// Il giorno del subentro l'apparecchio e letto due volte con lo stesso indice:
// una per chi esce, una per chi entra. E il caso vero dell'apparecchio 03961107
// di Acquabona: Dimai cessa il 09/03/2025, Baldin subentra il giorno dopo, e
// l'11/03 entrambi hanno lettura 1622.
const giornoDelSubentro = () => ([
    {
        _id: 'l-entra', consumo: 1622, data_lettura: '2025-03-11',
        contatore: { _id: 'c-entra', seriale: '03961107', scadenza: '2099-12-31', cliente: { cognome: 'Baldin' } },
    },
    {
        _id: 'l-esce', consumo: 1622, data_lettura: '2025-03-11',
        contatore: { _id: 'c-esce', seriale: '03961107', scadenza: '2025-03-09', cliente: { cognome: 'Dimai' } },
    },
]);

test('il giorno del subentro viene prima chi cessa', () => {
    // Con la sola data le due righe sono a pari merito e l'ordine lo decideva
    // l'`_id`, che non c'entra niente: capitando prima il subentrante, il
    // consumo del periodo precedente veniva addebitato a lui.
    const letture = giornoDelSubentro();
    ordinaPerSubentro(letture);

    assert.deepEqual(letture.map((l) => l._id), ['l-esce', 'l-entra']);
});

test('il consumo del periodo va a chi lo ha consumato, non a chi subentra', () => {
    const letture = giornoDelSubentro();
    ordinaPerSubentro(letture);

    const righe = abbinaLettureAllePrecedenti({
        letture,
        anteriori: [{ contatore: 'c-esce', consumo: 1596, data_lettura: '2024-11-11' }],
        apparecchioDelContatore: new Map([
            ['c-esce', 'seriale:03961107'],
            ['c-entra', 'seriale:03961107'],
        ]),
    });

    const uscente = righe.find((r) => r.denominazione.includes('Dimai'));
    const subentrante = righe.find((r) => r.denominazione.includes('Baldin'));

    assert.equal(uscente.consumi, 26, 'i 26 mc sono di chi ha avuto l acqua fino al 9 marzo');
    assert.equal(subentrante.consumi, 0, 'chi entra parte dall indice trovato');
});

test('un contatore ancora in servizio va per ultimo, comunque sia scritta la fine', () => {
    // Il gestionale precedente scriveva 31/12/2099 invece di lasciare vuoto:
    // vanno trattati uguale, altrimenti l'ordine dipende da come e stato
    // importato il record.
    const letture = [
        { _id: 'sentinella', data_lettura: '2025-03-11', contatore: { scadenza: '2099-12-31' } },
        { _id: 'senza-fine', data_lettura: '2025-03-11', contatore: {} },
        { _id: 'cessato', data_lettura: '2025-03-11', contatore: { scadenza: '2025-03-09' } },
    ];
    ordinaPerSubentro(letture);

    assert.equal(letture[0]._id, 'cessato', 'chi cessa viene prima');
    // Fra i due ancora in servizio l'ordine non conta - e giusto che non conti -
    // ma nessuno dei due deve precedere il cessato.
    assert.deepEqual(
        [...letture.slice(1)].map((l) => l._id).sort(),
        ['senza-fine', 'sentinella'].sort()
    );
});

test('le date diverse restano in ordine di calendario', () => {
    const letture = [
        { _id: 'nov', data_lettura: '2025-11-14', contatore: { scadenza: '2025-03-09' } },
        { _id: 'mar', data_lettura: '2025-03-11', contatore: {} },
    ];
    ordinaPerSubentro(letture);

    assert.deepEqual(letture.map((l) => l._id), ['mar', 'nov'], 'la data viene prima della scadenza');
});

test('il riepilogo segnala i condominiali senza quote di riparto', () => {
    // Piu intestatari ancora attivi sullo stesso apparecchio: il consumo
    // andrebbe diviso fra loro, e senza le quote finisce tutto sul primo. Il
    // totale dell'elenco resta giusto, ma il BIM fatturerebbe a una persona
    // sola quello che hanno consumato in cinque.
    const condominiale = (cognome, consumo) => rigaDaLettura({
        lettura: { consumo, data_lettura: '2025-10-31' },
        letturaPrecedente: { consumo: 0 },
        contatore: { seriale: '00720207', scadenza: '2099-12-31' },
        edificio: {},
        cliente: { cognome, nome: '', codice_fiscale: 'AAAAAA00A00A000A' },
    });

    const riepilogo = riepilogoDelleRighe(2025, [condominiale('Pompanin', 97), condominiale('Huber', 97)]);
    assert.equal(riepilogo.daRipartire, 1);
});

test('un subentro non viene scambiato per un condominiale', () => {
    // La differenza e che uno dei due e cessato: li il consumo non si divide,
    // si passa di mano.
    const riga = (cognome, scadenza) => rigaDaLettura({
        lettura: { consumo: 1622, data_lettura: '2025-03-11' },
        letturaPrecedente: { consumo: 1596 },
        contatore: { seriale: '03961107', scadenza },
        edificio: {},
        cliente: { cognome, nome: '', codice_fiscale: 'AAAAAA00A00A000A' },
    });

    const riepilogo = riepilogoDelleRighe(2025, [riga('Dimai', '2025-03-09'), riga('Baldin', '2099-12-31')]);
    assert.equal(riepilogo.daRipartire, 0);
});


test('chi produce le righe dell anno mette in ordine i subentri', () => {
    // I test qui sopra provano `ordinaPerSubentro`, non che qualcuno la chiami:
    // togliendo la chiamata restavano tutti verdi mentre sull'archivio vero i
    // 26 mc tornavano al cliente sbagliato. Qui si legge il sorgente, perche il
    // resto di `righeDellAnno` sono tre query al database.
    const sorgente = readFileSync(join(__dirname, '..', 'services', 'elencoBim.js'), 'utf8');
    const corpo = sorgente.slice(sorgente.indexOf('const righeDellAnno'));

    assert.match(
        corpo.slice(0, corpo.indexOf('abbinaLettureAllePrecedenti')),
        /^\s*ordinaPerSubentro\(letture\);/m,
        'le letture vanno ordinate prima di abbinarle alle precedenti'
    );
});
