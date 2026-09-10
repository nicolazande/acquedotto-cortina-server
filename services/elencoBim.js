// L'elenco dei consumi che una volta l'anno va al BIM, che sulla base di quello
// fattura fognatura e depurazione.
//
// Sono gli stessi dati per tre formati: chi lo riceve lo vuole in Excel per
// rielaborarlo, in PDF per archiviarlo, in Word per allegarlo a una lettera. Le
// righe si preparano una volta sola e i tre formati le impaginano, cosi non puo
// succedere che il PDF dica una cosa e il foglio di calcolo un'altra.

const Lettura = require('../models/Lettura');
// Serviti dalla popolate qui sotto: chiesti per nome, vanno registrati, e
// non si puo contare sul fatto che a caricarli sia stato qualcun altro.
const Contatore = require('../models/Contatore');
require('../models/Cliente');
require('../models/Edificio');
const { creaZip } = require('../utils/zip');
const { formatItalianDate, toDate } = require('../utils/dates');
const { customerLabel } = require('../utils/customer');
const { PdfDocument, larghezzaDelTesto } = require('./invoicePdf');

// Le larghezze sono pesi, non punti: `creaPdf` li scala sulla pagina.
//
// Sono misurate, non stimate a occhio: per ognuna si e preso quanto occupa
// davvero il testo che ci finisce dentro nell'archivio di oggi (il 95 per cento
// piu corto), piu lo spazio ai lati, e lo spazio avanzato e andato alle due
// colonne che troncavano ancora. I titoli sono corti apposta: su una colonna di
// numeri "Lett. att." dice quanto "Lettura Attuale" e lascia la larghezza al
// dato invece che all'intestazione.
const COLONNE = [
    { titolo: 'Codice', campo: 'codiceUtente', larghezza: 33 },
    { titolo: 'Denominazione', campo: 'denominazione', larghezza: 166 },
    { titolo: 'Cod. fiscale', campo: 'codiceFiscale', larghezza: 79 },
    { titolo: 'Partita IVA', campo: 'partitaIva', larghezza: 50 },
    { titolo: 'Seriale', campo: 'seriale', larghezza: 65 },
    { titolo: 'Indirizzo', campo: 'indirizzo', larghezza: 84 },
    { titolo: 'Lett. att.', campo: 'letturaAttuale', larghezza: 36, numero: true },
    { titolo: 'Lett. prec.', campo: 'letturaPrecedente', larghezza: 39, numero: true },
    { titolo: 'Quota', campo: 'percentuale', larghezza: 28, numero: true },
    { titolo: 'Data', campo: 'dataLettura', larghezza: 43 },
    { titolo: 'Consumi', campo: 'consumi', larghezza: 36, numero: true },
    { titolo: 'Tipo fornitura', campo: 'tipoFornitura', larghezza: 135 },
];

const testo = (valore) => (valore === null || valore === undefined ? '' : String(valore));


// Da una lettura alla riga dell'elenco. La quota di riparto conta: su un
// contatore condominiale il consumo che il BIM fattura a ciascuno e la sua
// parte, non il totale del contatore.
const rigaDaLettura = ({ lettura, contatore, cliente, edificio, letturaPrecedente }) => {
    const attuale = Number(lettura?.consumo ?? 0);
    const precedente = Number(letturaPrecedente?.consumo ?? 0);
    const quota = contatore?.consumo ? Number(contatore.consumo) : 100;

    return {
        codiceUtente: testo(cliente?.codice_cliente_erp),
        denominazione: customerLabel(cliente),
        codiceFiscale: testo(cliente?.codice_fiscale),
        partitaIva: testo(cliente?.partita_iva),
        seriale: testo(contatore?.seriale),
        indirizzo: testo(edificio?.indirizzo || contatore?.nome_edificio),
        letturaAttuale: attuale,
        letturaPrecedente: precedente,
        percentuale: quota,
        dataLettura: formatItalianDate(lettura?.data_lettura),
        consumi: Math.max(0, attuale - precedente),
        tipoFornitura: testo(contatore?.tipo_attivita),
        // La data cosi com'e, per ordinare e confrontare: `dataLettura` e gia
        // scritta in giorno/mese/anno e come testo si ordina sbagliata.
        data: toDate(lettura?.data_lettura),
    };
};

// Un .xlsx e un archivio zip di file XML: sono quattro, il minimo che Excel,
// LibreOffice e Fogli Google accettano. Scriverli a mano evita una dipendenza da
// qualche megabyte per produrre una tabella, come si e gia fatto per il PDF
// delle fatture e per l'archivio delle fatture elettroniche.
const xmlSicuro = (valore) => String(valore ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const riferimento = (colonna, riga) => {
    let nome = '';
    let n = colonna;
    do {
        nome = String.fromCharCode(65 + (n % 26)) + nome;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return `${nome}${riga}`;
};

const cella = (valore, colonna, riga, indice) => {
    const rif = riferimento(indice, riga);

    if (colonna?.numero && valore !== '' && Number.isFinite(Number(valore))) {
        return `<c r="${rif}"><v>${Number(valore)}</v></c>`;
    }

    return `<c r="${rif}" t="inlineStr"><is><t xml:space="preserve">${xmlSicuro(valore)}</t></is></c>`;
};

const foglioXml = (righe) => {
    const intestazione = `<row r="1">${COLONNE.map((c, i) => cella(c.titolo, null, 1, i)).join('')}</row>`;
    const corpo = righe
        .map((r, n) => `<row r="${n + 2}">${COLONNE.map((c, i) => cella(r[c.campo], c, n + 2, i)).join('')}</row>`)
        .join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<sheetData>${intestazione}${corpo}</sheetData></worksheet>`;
};

const PARTI_FISSE = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '</Relationships>',
};

const creaExcel = (righe, titolo) => creaZip([
    ...Object.entries(PARTI_FISSE).map(([nome, contenuto]) => ({ nome, contenuto: Buffer.from(contenuto, 'utf8') })),
    {
        nome: 'xl/workbook.xml',
        contenuto: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + `<sheets><sheet name="${xmlSicuro(titolo).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`, 'utf8'),
    },
    { nome: 'xl/worksheets/sheet1.xml', contenuto: Buffer.from(foglioXml(righe), 'utf8') },
]);


// Il PDF: la stessa tabella, impaginata in orizzontale perche le dodici colonne
// non stanno in verticale. Usa lo stesso motore delle fatture.
const MARGINE = 24;
const LARGHEZZA = 842;
const ALTEZZA = 595;

// Lo spazio lasciato libero ai due lati della cella. Serve tutto e due: senza
// quello a destra il testo finisce appoggiato alla colonna successiva.
const GRONDA = 10;

// Novecento righe tutte uguali si leggono male: la riga sotto l'intestazione
// stacca i titoli dai dati, e la campitura ogni due righe aiuta l'occhio a non
// cambiare riga a meta strada. Grigi chiari, che devono restare leggibili anche
// stampati in bianco e nero.
const RIGA_INTESTAZIONE = [0.62, 0.62, 0.62];
const FONDO_ALTERNATO = [0.955, 0.955, 0.955];

// Le celle del PDF non mandano a capo: un testo piu largo della colonna
// sborderebbe sopra quella accanto, e in un elenco di 900 righe basta una
// ragione sociale lunga per rendere illeggibile la riga. Meglio troncarlo, che
// e anche come lo stampava il gestionale precedente.
//
// Quanto ci sta si chiede al font, non si stima sul numero di caratteri: un
// codice fiscale e tutto maiuscole e cifre e a parita di lunghezza occupa un
// terzo in piu di un nome scritto normalmente. Contandolo a caratteri usciva
// dalla colonna e finiva appoggiato alla partita IVA.
const perLaCella = (valore, larghezza, corpo) => {
    const testoIntero = String(valore ?? '');
    const disponibile = larghezza - GRONDA;

    if (larghezzaDelTesto(testoIntero, corpo) <= disponibile) {
        return testoIntero;
    }

    const puntini = larghezzaDelTesto('...', corpo);
    let tagliato = testoIntero;

    while (tagliato && larghezzaDelTesto(tagliato, corpo) + puntini > disponibile) {
        tagliato = tagliato.slice(0, -1);
    }

    return `${tagliato}...`;
};

const creaPdf = (righe, { anno, ente }) => {
    // Dodici colonne non stanno in verticale: l'A4 va girato.
    const pdf = new PdfDocument({ larghezza: LARGHEZZA, altezza: ALTEZZA });
    const scala = (LARGHEZZA - MARGINE * 2) / COLONNE.reduce((s, c) => s + c.larghezza, 0);
    const larghezze = COLONNE.map((c) => c.larghezza * scala);

    let y = MARGINE;
    let primaPagina = true;

    const intestazione = () => {
        if (!primaPagina) pdf.addPage();
        primaPagina = false;
        y = MARGINE;
        pdf.text(ente, MARGINE, y, { size: 11, font: 'bold' });
        pdf.text(`Elenco consumi - Anno ${anno}`, LARGHEZZA - MARGINE - 150, y, { size: 10 });
        y += 22;
        let x = MARGINE;
        COLONNE.forEach((c, i) => {
            pdf.cellText(perLaCella(c.titolo, larghezze[i], 6.5), x, y, larghezze[i], 14, {
                size: 6.5,
                font: 'bold',
                align: c.numero ? 'right' : 'left',
                padding: GRONDA / 2,
            });
            x += larghezze[i];
        });
        y += 14;
        pdf.line(MARGINE, y, LARGHEZZA - MARGINE, y, { color: RIGA_INTESTAZIONE, lineWidth: 0.5 });
        y += 2;
    };

    intestazione();

    righe.forEach((riga, n) => {
        if (y > ALTEZZA - MARGINE - 14) intestazione();

        if (n % 2 === 1) {
            pdf.rect(MARGINE, y, LARGHEZZA - MARGINE * 2, 12, { fill: FONDO_ALTERNATO, stroke: null });
        }

        let x = MARGINE;
        COLONNE.forEach((c, i) => {
            pdf.cellText(perLaCella(riga[c.campo], larghezze[i], 6.5), x, y, larghezze[i], 12, {
                size: 6.5,
                align: c.numero ? 'right' : 'left',
                padding: GRONDA / 2,
            });
            x += larghezze[i];
        });
        y += 12;
    });

    pdf.text(`${righe.length} utenze`, MARGINE, ALTEZZA - MARGINE, { size: 7 });
    return pdf.toBuffer();
};

// Il Word: un .docx e anch'esso uno zip di XML, con una parte sola che conta.
// Non serve altro che una tabella, quindi si scrive come si e fatto per l'Excel.
// Una cella deve dichiarare la propria larghezza: senza `tcW` il documento e
// XML valido ma nessun programma lo apre - "impossibile caricare il file", senza
// altre spiegazioni.
// Word misura in twentieths of a point: la pagina orizzontale ne ha 16838, meno
// i margini restano quelli qui sotto. La scala si ricava dai pesi delle colonne
// invece di essere un numero fisso, altrimenti basta ritoccare una larghezza
// perche la tabella esca dal foglio - e a differenza del PDF, Word non lo dice.
const PAGINA_WORD = { larghezza: 16838, altezza: 11906, margine: 567 };
const LARGHEZZA_UTILE_WORD = PAGINA_WORD.larghezza - PAGINA_WORD.margine * 2;
const SCALA_WORD = LARGHEZZA_UTILE_WORD / COLONNE.reduce((somma, c) => somma + c.larghezza, 0);

const cellaWord = (valore, larghezza) => '<w:tc><w:tcPr>'
    + `<w:tcW w:w="${Math.round(larghezza * SCALA_WORD)}" w:type="dxa"/></w:tcPr>`
    + `<w:p><w:r><w:t xml:space="preserve">${xmlSicuro(valore)}</w:t></w:r></w:p></w:tc>`;

const creaWord = (righe, { anno, ente }) => {
    const titolo = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">'
        + `${xmlSicuro(`${ente} - Elenco consumi ${anno}`)}</w:t></w:r></w:p>`;
    const intestazione = `<w:tr>${COLONNE.map((c) => cellaWord(c.titolo, c.larghezza)).join('')}</w:tr>`;
    const corpo = righe
        .map((r) => `<w:tr>${COLONNE.map((c) => cellaWord(r[c.campo], c.larghezza)).join('')}</w:tr>`)
        .join('');
    // La tabella dichiara bordi e larghezza complessiva, e il corpo la
    // dimensione del foglio: in orizzontale, perche le dodici colonne in
    // verticale non ci stanno.
    const proprieta = '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'
        + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
            .map((lato) => `<w:${lato} w:val="single" w:sz="4" w:color="999999"/>`).join('')
        + '</w:tblBorders></w:tblPr>';
    const foglio = `<w:sectPr><w:pgSz w:w="${PAGINA_WORD.larghezza}" w:h="${PAGINA_WORD.altezza}" w:orient="landscape"/>`
        + `<w:pgMar w:top="${PAGINA_WORD.margine}" w:right="${PAGINA_WORD.margine}"`
        + ` w:bottom="${PAGINA_WORD.margine}" w:left="${PAGINA_WORD.margine}"/></w:sectPr>`;

    const documento = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + `${titolo}<w:tbl>${proprieta}${intestazione}${corpo}</w:tbl>${foglio}</w:body></w:document>`;

    return creaZip([
        {
            nome: '[Content_Types].xml',
            contenuto: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                + '<Default Extension="xml" ContentType="application/xml"/>'
                + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                + '</Types>', 'utf8'),
        },
        {
            nome: '_rels/.rels',
            contenuto: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                + '</Relationships>', 'utf8'),
        },
        { nome: 'word/document.xml', contenuto: Buffer.from(documento, 'utf8') },
    ]);
};

// Le righe dell'anno, prese in blocco. Una lettura alla volta vorrebbe dire una
// query per la precedente per ognuna delle circa mille letture: qui sono tre
// query in tutto, e la precedente si trova scorrendo le letture ordinate.
//
// La precedente si cerca sul contatore FISICO, cioe sul seriale, non sul record.
// Quando un'utenza cambia intestatario nasce un contatore nuovo che continua a
// leggere lo stesso apparecchio: cercandola sul record, la prima lettura del
// subentrante non ne troverebbe nessuna e partirebbe da zero, addebitandogli
// come consumo dell'anno tutto lo storico dell'apparecchio. Sull'archivio di
// oggi sono 125 seriali con piu intestatari, e sul solo 2025 farebbero 76.987
// mc inesistenti.
const chiaveApparecchio = (contatore) => (
    contatore?.seriale ? `seriale:${contatore.seriale}` : `contatore:${contatore?._id}`
);

// L'abbinamento fra ogni lettura e quella che la precede sullo stesso
// apparecchio. Sta a parte dalle query perche e la parte che puo sbagliare, ed
// e l'unica che vale la pena verificare riga per riga.
const abbinaLettureAllePrecedenti = ({ letture, anteriori, apparecchioDelContatore }) => {
    const ultimaPrecedente = new Map();

    anteriori.forEach((l) => {
        const chiave = apparecchioDelContatore.get(String(l.contatore));
        if (chiave) ultimaPrecedente.set(chiave, l);
    });

    return letture.map((lettura) => {
        const contatore = lettura.contatore || {};
        const chiave = chiaveApparecchio(contatore);
        const letturaPrecedente = ultimaPrecedente.get(chiave);
        ultimaPrecedente.set(chiave, lettura);

        return rigaDaLettura({
            lettura,
            letturaPrecedente,
            contatore,
            cliente: contatore.cliente,
            edificio: contatore.edificio,
        });
    });
};

const righeDellAnno = async (anno) => {
    const inizio = new Date(Date.UTC(anno, 0, 1));
    const dopo = new Date(Date.UTC(anno + 1, 0, 1));

    const letture = await Lettura.find({ data_lettura: { $gte: inizio, $lt: dopo } })
        .populate({ path: 'contatore', populate: ['cliente', 'edificio'] })
        .sort({ data_lettura: 1, _id: 1 })
        .lean();

    // Tutti i record che leggono gli stessi apparecchi, non solo quelli con una
    // lettura quest'anno: il predecessore in genere e cessato da un pezzo.
    const seriali = [...new Set(letture.map((l) => l.contatore?.seriale).filter(Boolean))];
    const fratelli = await Contatore.find({ seriale: { $in: seriali } }).select('seriale').lean();

    const anteriori = await Lettura.find({
        contatore: { $in: fratelli.map((c) => c._id) },
        data_lettura: { $lt: inizio },
    }).sort({ data_lettura: 1, _id: 1 }).select('contatore consumo data_lettura').lean();

    return abbinaLettureAllePrecedenti({
        letture,
        anteriori,
        apparecchioDelContatore: new Map(fratelli.map((c) => [String(c._id), `seriale:${c.seriale}`])),
    });
};

// Cosa contiene l'elenco, senza produrlo. Serve a chi lo deve mandare: prima di
// scaricare novecento righe conviene sapere quante sono, di quanti metri cubi
// si parla e se c'e qualcosa che non torna. I numeri escono dalle stesse righe
// del file, cosi l'anteprima non puo dire una cosa e il documento un'altra.
// I conti sulle righe, separati da chi le va a prendere: e la parte che si puo
// sbagliare, e cosi si verifica senza database.
const riepilogoDelleRighe = (anno, righe) => {
    // Ordinate come date, non come testo: "01/11" e "31/10" scritte in
    // giorno/mese/anno si ordinano alfabeticamente al contrario del calendario.
    const date = righe.map((riga) => riga.data).filter(Boolean).sort((a, b) => a - b);

    return {
        anno,
        utenze: righe.length,
        consumi: righe.reduce((somma, riga) => somma + riga.consumi, 0),
        // Le tre cose che rendono un elenco da guardare prima di mandarlo.
        senzaCodiceFiscale: righe.filter((riga) => !riga.codiceFiscale && !riga.partitaIva).length,
        senzaConsumo: righe.filter((riga) => riga.consumi === 0).length,
        // Un consumo che riparte da zero e o un contatore nuovo o un subentro
        // che ha perso il predecessore: vale la pena guardarlo prima di mandare.
        primaLettura: righe.filter((riga) => riga.letturaPrecedente === 0 && riga.letturaAttuale > 0).length,
        dallaLettura: formatItalianDate(date[0]),
        allaLettura: formatItalianDate(date[date.length - 1]),
    };
};

const riepilogoDellAnno = async (anno) => riepilogoDelleRighe(anno, await righeDellAnno(anno));

module.exports = {
    COLONNE,
    abbinaLettureAllePrecedenti,
    creaExcel,
    creaPdf,
    creaWord,
    perLaCella,
    rigaDaLettura,
    riepilogoDelleRighe,
    riepilogoDellAnno,
    righeDellAnno,
};
