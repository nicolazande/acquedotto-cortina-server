// Una tabella di dati, stampabile nei tre formati che servono a chi la riceve:
// Excel per rielaborarla, PDF per guardarla o archiviarla, Word per allegarla a
// una lettera.
//
// Non sa niente di cosa contiene: prende le colonne e le righe e le impagina.
// Un elenco nuovo - l'Anagrafe Tributaria, o quello che verra - descrive le
// proprie colonne e ha i tre formati senza riscriverli, e una correzione
// all'impaginazione vale per tutti invece che per uno solo.
//
// Le colonne sono `{ titolo, campo, larghezza, numero }`. `larghezza` e un peso,
// non una misura: ogni formato lo scala sulla propria pagina, quindi contano i
// rapporti fra le colonne e non i valori assoluti. `numero` allinea a destra.

const { creaZip } = require('../utils/zip');
const { PdfDocument, larghezzaDelTesto } = require('./invoicePdf');

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

const foglioXml = (colonne, righe) => {
    const intestazione = `<row r="1">${colonne.map((c, i) => cella(c.titolo, null, 1, i)).join('')}</row>`;
    const corpo = righe
        .map((r, n) => `<row r="${n + 2}">${colonne.map((c, i) => cella(r[c.campo], c, n + 2, i)).join('')}</row>`)
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

const creaExcel = (colonne, righe, titolo) => creaZip([
    ...Object.entries(PARTI_FISSE).map(([nome, contenuto]) => ({ nome, contenuto: Buffer.from(contenuto, 'utf8') })),
    {
        nome: 'xl/workbook.xml',
        contenuto: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
            + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + `<sheets><sheet name="${xmlSicuro(titolo).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`, 'utf8'),
    },
    { nome: 'xl/worksheets/sheet1.xml', contenuto: Buffer.from(foglioXml(colonne, righe), 'utf8') },
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

const creaPdf = (colonne, righe, { anno, ente }) => {
    // Dodici colonne non stanno in verticale: l'A4 va girato.
    const pdf = new PdfDocument({ larghezza: LARGHEZZA, altezza: ALTEZZA });
    const scala = (LARGHEZZA - MARGINE * 2) / colonne.reduce((s, c) => s + c.larghezza, 0);
    const larghezze = colonne.map((c) => c.larghezza * scala);

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
        colonne.forEach((c, i) => {
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
        colonne.forEach((c, i) => {
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
const scalaWord = (colonne) => LARGHEZZA_UTILE_WORD / colonne.reduce((somma, c) => somma + c.larghezza, 0);

const cellaWord = (valore, larghezza, scala) => '<w:tc><w:tcPr>'
    + `<w:tcW w:w="${Math.round(larghezza * scala)}" w:type="dxa"/></w:tcPr>`
    + `<w:p><w:r><w:t xml:space="preserve">${xmlSicuro(valore)}</w:t></w:r></w:p></w:tc>`;

const creaWord = (colonne, righe, { anno, ente }) => {
    const titolo = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">'
        + `${xmlSicuro(`${ente} - Elenco consumi ${anno}`)}</w:t></w:r></w:p>`;
    const scala = scalaWord(colonne);
    const intestazione = `<w:tr>${colonne.map((c) => cellaWord(c.titolo, c.larghezza, scala)).join('')}</w:tr>`;
    const corpo = righe
        .map((r) => `<w:tr>${colonne.map((c) => cellaWord(r[c.campo], c.larghezza, scala)).join('')}</w:tr>`)
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

module.exports = {
    creaExcel,
    creaPdf,
    creaWord,
    perLaCella,
};
