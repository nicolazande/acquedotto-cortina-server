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
const { customerLabel } = require('../utils/customer');
const { PdfDocument } = require('./invoicePdf');

const COLONNE = [
    { titolo: 'Cod. Utente', campo: 'codiceUtente', larghezza: 12 },
    { titolo: 'Denominazione', campo: 'denominazione', larghezza: 34 },
    { titolo: 'Codice Fiscale', campo: 'codiceFiscale', larghezza: 18 },
    { titolo: 'Partita IVA', campo: 'partitaIva', larghezza: 14 },
    { titolo: 'Seriale', campo: 'seriale', larghezza: 16 },
    { titolo: 'Indirizzo', campo: 'indirizzo', larghezza: 28 },
    { titolo: 'Lettura Attuale', campo: 'letturaAttuale', larghezza: 15, numero: true },
    { titolo: 'Lettura Precedente', campo: 'letturaPrecedente', larghezza: 18, numero: true },
    { titolo: '%', campo: 'percentuale', larghezza: 5, numero: true },
    { titolo: 'Data Lettura', campo: 'dataLettura', larghezza: 13 },
    { titolo: 'Consumi m3', campo: 'consumi', larghezza: 12, numero: true },
    { titolo: 'Tipo Fornitura', campo: 'tipoFornitura', larghezza: 26 },
];

const testo = (valore) => (valore === null || valore === undefined ? '' : String(valore));

const dataItaliana = (data) => {
    if (!data) return '';
    const d = data instanceof Date ? data : new Date(data);
    if (Number.isNaN(d.getTime())) return '';
    const due = (n) => String(n).padStart(2, '0');
    return `${due(d.getUTCDate())}/${due(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

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
        dataLettura: dataItaliana(lettura?.data_lettura),
        consumi: Math.max(0, attuale - precedente),
        tipoFornitura: testo(contatore?.tipo_attivita),
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

// Le celle del PDF non mandano a capo: un testo piu largo della colonna
// sborderebbe sopra quella accanto, e in un elenco di 900 righe basta una
// ragione sociale lunga per rendere illeggibile la riga. Meglio troncarlo, che
// e anche come lo stampava il gestionale precedente. Il fattore 0.48 e la
// larghezza media di un carattere della Helvetica usata qui. I puntini sono
// tre punti e non il carattere unico, che il PDF scrive in ASCII e scarterebbe.
const LARGHEZZA_CARATTERE = 0.48;

const perLaCella = (valore, larghezza, corpo) => {
    const testoIntero = String(valore ?? '');
    const massimo = Math.max(Math.floor((larghezza - 6) / (corpo * LARGHEZZA_CARATTERE)), 1);
    if (testoIntero.length <= massimo) return testoIntero;
    return `${testoIntero.slice(0, Math.max(massimo - 3, 1))}...`;
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
            pdf.cellText(perLaCella(c.titolo, larghezze[i], 6.5), x, y, larghezze[i], 14, { size: 6.5, font: 'bold' });
            x += larghezze[i];
        });
        y += 14;
    };

    intestazione();

    righe.forEach((riga) => {
        if (y > ALTEZZA - MARGINE - 14) intestazione();
        let x = MARGINE;
        COLONNE.forEach((c, i) => {
            pdf.cellText(perLaCella(riga[c.campo], larghezze[i], 6.5), x, y, larghezze[i], 12, {
                size: 6.5,
                align: c.numero ? 'right' : 'left',
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
const cellaWord = (valore, larghezza) => '<w:tc><w:tcPr>'
    + `<w:tcW w:w="${Math.round(larghezza * 45)}" w:type="dxa"/></w:tcPr>`
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
    const foglio = '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
        + '<w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567"/></w:sectPr>';

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

module.exports = {
    COLONNE,
    creaExcel,
    creaPdf,
    creaWord,
    dataItaliana,
    abbinaLettureAllePrecedenti,
    righeDellAnno,
    rigaDaLettura,
    xmlSicuro,
};
