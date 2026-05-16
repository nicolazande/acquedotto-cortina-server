const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('../models/Articolo');
require('../models/Cliente');
require('../models/Contatore');
require('../models/Fascia');
const Fattura = require('../models/Fattura');
require('../models/Lettura');
require('../models/Listino');
require('../models/Scadenza');
const Servizio = require('../models/Servizio');

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const BLUE = [0, 0.6, 0.9];
const LIGHT_BLUE = [0.78, 0.96, 0.96];
const GREEN = [0, 0.66, 0.32];
const RED = [0.93, 0.25, 0.18];
const BLACK = [0, 0, 0];
const GRAY = [0.82, 0.82, 0.82];
const LIGHT_GRAY = [0.94, 0.94, 0.94];
const BORDER_GRAY = [0.72, 0.72, 0.72];

const companyConfig = {
    name: process.env.INVOICE_COMPANY_NAME || 'COOPERATIVA DI GESTIONE ACQUEDOTTO ZUEL DI SOPRA',
    footer: process.env.INVOICE_COMPANY_FOOTER || 'COOPERATIVA DI GESTIONE ACQUEDOTTO - Pian de Lago, 64 32043 CORTINA D AMPEZZO (BL) - C.F./P.I. 00296800253 - R.E.A. Belluno 65393',
    website: process.env.INVOICE_COMPANY_WEBSITE || 'www.acquedottozuel.it',
    email: process.env.INVOICE_COMPANY_EMAIL || 'acquedottozuel@gmail.com',
    phoneDirect: process.env.INVOICE_PHONE_DIRECT || '0436 867504',
    bankName: process.env.INVOICE_BANK_NAME || 'CORTINA BANCA Credito cooperativo Italiano',
    iban: process.env.INVOICE_IBAN || 'IT11M 08511 61070 0000 0000 6953',
};
const invoiceAssets = {
    logo: path.join(__dirname, '..', 'assets', 'invoice', 'logo-zuel.ppm'),
    numeroVerdeInfo: path.join(__dirname, '..', 'assets', 'invoice', 'numero-verde-info.ppm'),
    numeroVerdeEmergenza: path.join(__dirname, '..', 'assets', 'invoice', 'numero-verde-emergenza.ppm'),
};

const isEmpty = (value) => value === undefined || value === null || value === '';

const asciiText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/€/g, 'EUR')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\()]/g, '\\$&');

const numberOrZero = (value) => {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
};

const formatMoney = (value) => `Euro ${numberOrZero(value).toFixed(2).replace('.', ',')}`;
const formatNumber = (value) => Number.isFinite(Number(value)) ? String(Number(value)).replace('.', ',') : '';
const formatDate = (value) => {
    if (!value) {
        return '';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('it-IT');
};

const customerName = (cliente, fattura) => (
    cliente?.ragione_sociale
    || [cliente?.cognome, cliente?.nome].filter(Boolean).join(' ').trim()
    || fattura?.ragione_sociale
    || fattura?.nome_cliente
    || ''
);

const joinAddress = (...parts) => parts.filter((part) => !isEmpty(part)).join(' ').trim();

const billingAddress = (cliente) => {
    const invoiceAddress = joinAddress(cliente?.indirizzo_fatturazione, cliente?.numero_fatturazione);
    const residenceAddress = joinAddress(cliente?.indirizzo_residenza, cliente?.numero_residenza);

    return {
        address: invoiceAddress || residenceAddress,
        city: joinAddress(
            cliente?.cap_fatturazione || cliente?.cap_residenza,
            cliente?.localita_fatturazione || cliente?.localita_residenza,
            cliente?.provincia_fatturazione || cliente?.provincia_residenza
        ),
    };
};

const invoiceCode = (fattura) => [
    fattura?.anno,
    fattura?.numero !== undefined ? String(fattura.numero).padStart(4, '0') : '',
].filter(Boolean).join('-');

const readPpmToken = (buffer, cursor) => {
    let index = cursor;

    while (index < buffer.length) {
        const char = String.fromCharCode(buffer[index]);
        if (char === '#') {
            while (index < buffer.length && String.fromCharCode(buffer[index]) !== '\n') {
                index += 1;
            }
        } else if (/\s/.test(char)) {
            index += 1;
        } else {
            break;
        }
    }

    const start = index;
    while (index < buffer.length && !/\s/.test(String.fromCharCode(buffer[index]))) {
        index += 1;
    }

    return {
        token: buffer.toString('ascii', start, index),
        cursor: index,
    };
};

const loadPpmImage = (filePath) => {
    const buffer = fs.readFileSync(filePath);
    let cursor = 0;
    const magic = readPpmToken(buffer, cursor);
    cursor = magic.cursor;

    if (magic.token !== 'P6') {
        throw new Error(`Unsupported invoice image format: ${filePath}`);
    }

    const widthToken = readPpmToken(buffer, cursor);
    cursor = widthToken.cursor;
    const heightToken = readPpmToken(buffer, cursor);
    cursor = heightToken.cursor;
    const maxToken = readPpmToken(buffer, cursor);
    cursor = maxToken.cursor;

    if (Number(maxToken.token) !== 255) {
        throw new Error(`Unsupported invoice image depth: ${filePath}`);
    }

    while (cursor < buffer.length && /\s/.test(String.fromCharCode(buffer[cursor]))) {
        cursor += 1;
    }

    return {
        data: zlib.deflateSync(buffer.subarray(cursor)),
        height: Number(heightToken.token),
        width: Number(widthToken.token),
    };
};

let cachedAssets = null;
const getInvoiceAssets = () => {
    if (!cachedAssets) {
        cachedAssets = {
            Logo: loadPpmImage(invoiceAssets.logo),
            PhoneInfo: loadPpmImage(invoiceAssets.numeroVerdeInfo),
            PhoneEmergency: loadPpmImage(invoiceAssets.numeroVerdeEmergenza),
        };
    }

    return cachedAssets;
};

const registerInvoiceAssets = (pdf) => {
    Object.entries(getInvoiceAssets()).forEach(([name, image]) => {
        pdf.addImage(name, image);
    });
};

class PdfDocument {
    constructor() {
        this.pages = [[]];
        this.page = this.pages[0];
        this.images = new Map();
    }

    addPage() {
        this.page = [];
        this.pages.push(this.page);
    }

    write(command) {
        this.page.push(command);
    }

    addImage(name, image) {
        this.images.set(name, image);
    }

    y(topY) {
        return PAGE_HEIGHT - topY;
    }

    color([r, g, b], stroke = false) {
        this.write(`${r} ${g} ${b} ${stroke ? 'RG' : 'rg'}`);
    }

    lineWidth(width) {
        this.write(`${width} w`);
    }

    rect(x, y, width, height, { fill, stroke = BLACK, lineWidth = 0.7 } = {}) {
        this.write('q');
        this.lineWidth(lineWidth);
        if (fill) {
            this.color(fill);
        }
        if (stroke) {
            this.color(stroke, true);
        }
        this.write(`${x} ${this.y(y + height)} ${width} ${height} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
        this.write('Q');
    }

    line(x1, y1, x2, y2, { color = BLACK, lineWidth = 0.6 } = {}) {
        this.write('q');
        this.lineWidth(lineWidth);
        this.color(color, true);
        this.write(`${x1} ${this.y(y1)} m ${x2} ${this.y(y2)} l S`);
        this.write('Q');
    }

    circle(cx, cy, radius, { fill, stroke = BLUE, lineWidth = 1.4 } = {}) {
        const c = radius * 0.5522847498;
        const y = this.y(cy);

        this.write('q');
        this.lineWidth(lineWidth);
        if (fill) {
            this.color(fill);
        }
        if (stroke) {
            this.color(stroke, true);
        }
        this.write([
            `${cx + radius} ${y} m`,
            `${cx + radius} ${y + c} ${cx + c} ${y + radius} ${cx} ${y + radius} c`,
            `${cx - c} ${y + radius} ${cx - radius} ${y + c} ${cx - radius} ${y} c`,
            `${cx - radius} ${y - c} ${cx - c} ${y - radius} ${cx} ${y - radius} c`,
            `${cx + c} ${y - radius} ${cx + radius} ${y - c} ${cx + radius} ${y} c`,
            fill && stroke ? 'B' : fill ? 'f' : 'S',
        ].join(' '));
        this.write('Q');
    }

    image(name, x, y, width, height) {
        this.write('q');
        this.write(`${width} 0 0 ${height} ${x} ${this.y(y + height)} cm /${name} Do`);
        this.write('Q');
    }

    text(value, x, y, {
        align = 'left',
        color = BLACK,
        font = 'regular',
        size = 9,
        width,
    } = {}) {
        const fontName = font === 'bold' ? 'F2' : font === 'italic' ? 'F3' : 'F1';
        const content = asciiText(value);
        const estimatedWidth = content.length * size * 0.48;
        const offset = align === 'right' && width ? Math.max(width - estimatedWidth, 0)
            : align === 'center' && width ? Math.max((width - estimatedWidth) / 2, 0)
                : 0;

        this.write('q');
        this.color(color);
        this.write(`BT /${fontName} ${size} Tf ${x + offset} ${this.y(y)} Td (${content}) Tj ET`);
        this.write('Q');
    }

    boxText(value, x, y, width, height, {
        align = 'center',
        color = BLACK,
        font = 'bold',
        size = 8,
    } = {}) {
        this.text(value, x, y + (height / 2) + (size * 0.35), {
            align,
            color,
            font,
            size,
            width,
        });
    }

    cellText(value, x, y, width, height, {
        align = 'left',
        color = BLACK,
        font = 'regular',
        padding = 3,
        size = 6,
    } = {}) {
        const textX = align === 'left' ? x + padding : x;
        const textWidth = Math.max(width - (padding * 2), 1);

        this.boxText(value, textX, y, textWidth, height, {
            align,
            color,
            font,
            size,
        });
    }

    wrappedText(value, x, y, width, {
        color = BLACK,
        font = 'regular',
        lineHeight = 10,
        size = 8,
    } = {}) {
        const words = String(value || '').split(/\s+/).filter(Boolean);
        const maxChars = Math.max(Math.floor(width / (size * 0.52)), 1);
        const lines = [];
        let line = '';

        for (const word of words) {
            const nextLine = line ? `${line} ${word}` : word;
            if (nextLine.length > maxChars && line) {
                lines.push(line);
                line = word;
            } else {
                line = nextLine;
            }
        }

        if (line) {
            lines.push(line);
        }

        lines.forEach((item, index) => {
            this.text(item, x, y + (index * lineHeight), { color, font, size, width });
        });

        return y + Math.max(lines.length, 1) * lineHeight;
    }

    toBuffer() {
        const images = [...this.images.entries()];
        const pageRefs = this.pages.map((_, index) => 3 + index);
        const imageRefs = images.map((_, index) => 3 + this.pages.length + index);
        const contentRefs = this.pages.map((_, index) => 3 + this.pages.length + images.length + index);
        const xObjects = images.length > 0
            ? `/XObject << ${images.map(([name], index) => `/${name} ${imageRefs[index]} 0 R`).join(' ')} >>`
            : '';
        const objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${this.pages.length} >>`,
        ];

        this.pages.forEach((_, index) => {
            const contentRef = contentRefs[index];
            objects.push([
                '<< /Type /Page',
                '/Parent 2 0 R',
                `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
                '/Resources << /Font <<',
                '/F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
                '/F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
                '/F3 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>',
                `>> ${xObjects} >>`,
                `/Contents ${contentRef} 0 R`,
                '>>',
            ].join('\n'));
        });

        images.forEach(([, image]) => {
            objects.push(Buffer.concat([
                Buffer.from([
                    '<< /Type /XObject',
                    '/Subtype /Image',
                    `/Width ${image.width}`,
                    `/Height ${image.height}`,
                    '/ColorSpace /DeviceRGB',
                    '/BitsPerComponent 8',
                    '/Filter /FlateDecode',
                    `/Length ${image.data.length}`,
                    '>>',
                    'stream',
                    '',
                ].join('\n')),
                image.data,
                Buffer.from('\nendstream'),
            ]));
        });

        this.pages.forEach((commands) => {
            const content = commands.join('\n');
            objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
        });

        const pdfParts = [Buffer.from('%PDF-1.4\n')];
        const offsets = [0];
        const length = () => pdfParts.reduce((total, part) => total + part.length, 0);
        const push = (value) => {
            pdfParts.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
        };

        objects.forEach((content, index) => {
            offsets.push(length());
            push(`${index + 1} 0 obj\n`);
            push(content);
            push('\nendobj\n');
        });

        const xrefOffset = length();
        push(`xref\n0 ${objects.length + 1}\n`);
        push('0000000000 65535 f \n');
        offsets.slice(1).forEach((offset) => {
            push(`${String(offset).padStart(10, '0')} 00000 n \n`);
        });
        push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

        return Buffer.concat(pdfParts);
    }
}

const drawCompanyHeader = (pdf) => {
    pdf.image('Logo', 66, 52, 240, 79);
};

const drawCustomerBox = (pdf, fattura, cliente) => {
    const address = billingAddress(cliente);
    const code = cliente?.codice_cliente_erp || String(cliente?._id || '').slice(-8);

    pdf.rect(352, 40, 218, 17, { fill: LIGHT_BLUE, stroke: BLACK });
    pdf.boxText(`Codice Cliente: ${code}`, 352, 40, 218, 17, { font: 'bold', size: 8 });
    pdf.text(customerName(cliente, fattura), 353, 74, { size: 8 });
    pdf.text(address.address, 353, 89, { size: 8 });
    pdf.text(address.city, 353, 104, { size: 8 });
    pdf.text(`C.F.  ${cliente?.codice_fiscale || cliente?.partita_iva || ''}`, 353, 121, { size: 8 });

    pdf.text('Destinazione', 353, 162, { font: 'bold', size: 7 });
    pdf.text(cliente?.destinazione_fatturazione || customerName(cliente, fattura), 353, 182, { font: 'bold', size: 7 });
    pdf.text(address.address, 353, 200, { font: 'bold', size: 7 });
    pdf.text(address.city, 353, 218, { font: 'bold', size: 7 });
};

const drawPhoneBoxes = (pdf) => {
    pdf.rect(20, 142, 263, 105, { stroke: BLACK });
    pdf.image('PhoneInfo', 28, 146, 122, 47);
    pdf.text('PER INFORMAZIONI', 156, 160, { align: 'center', font: 'bold', size: 6, width: 116 });
    pdf.text('dal Lunedi al Sabato', 156, 170, { align: 'center', font: 'bold', size: 6, width: 116 });
    pdf.text('dalle ore 9:00 alle ore 14:00', 156, 180, { align: 'center', font: 'bold', size: 6, width: 116 });
    pdf.line(82, 195, 270, 195, { color: BLACK, lineWidth: 0.7 });
    pdf.image('PhoneEmergency', 158, 200, 122, 47);
    pdf.text('PRONTO INTERVENTO', 30, 215, { align: 'center', font: 'bold', size: 6, width: 105 });
    pdf.text('rispondiamo 24 ore su 24', 30, 225, { align: 'center', font: 'bold', size: 6, width: 105 });
    pdf.text('tutti i giorni', 30, 235, { align: 'center', font: 'bold', size: 6, width: 105 });
};

const getVatRate = (service) => {
    if (!isEmpty(service.aliquota_iva)) {
        return numberOrZero(service.aliquota_iva);
    }

    const match = String(service.articolo?.iva || '').match(/(\d+(?:[,.]\d+)?)/);
    return match ? numberOrZero(match[1]) : 0;
};

const drawTaxSummary = (pdf, fattura, servizi) => {
    const groups = servizi.reduce((map, service) => {
        const rate = getVatRate(service);
        const current = map.get(rate) || { imponibile: 0, iva: 0 };
        const imponibile = numberOrZero(service.valore_unitario);
        current.imponibile += imponibile;
        current.iva += imponibile * rate / 100;
        map.set(rate, current);
        return map;
    }, new Map());

    pdf.rect(20, 252, 263, 104, { stroke: BLACK });
    pdf.cellText('Totale bolletta', 20, 253, 183, 20, { align: 'center', size: 6 });
    pdf.cellText(formatMoney(fattura.totale_fattura), 203, 253, 80, 20, { align: 'center', font: 'bold', size: 7 });
    pdf.line(20, 274, 283, 274, { color: GRAY });
    pdf.line(142, 274, 142, 308, { color: GRAY });
    pdf.line(206, 274, 206, 308, { color: GRAY });
    pdf.cellText('IMPORTI', 20, 275, 122, 17, { align: 'center', font: 'bold', size: 6 });
    pdf.cellText('IVA', 142, 275, 64, 17, { align: 'center', font: 'bold', size: 6 });
    pdf.cellText('Imponibile', 206, 275, 77, 17, { align: 'center', font: 'bold', size: 6 });
    pdf.line(20, 292, 283, 292, { color: GRAY });

    let y = 292;
    [...groups.entries()].forEach(([rate, values]) => {
        pdf.cellText(`IVA ${formatNumber(rate)}%`, 20, y, 122, 15, { align: 'center', size: 6 });
        pdf.cellText(formatMoney(values.iva), 142, y, 64, 15, { align: 'center', size: 6 });
        pdf.cellText(formatMoney(values.imponibile), 206, y, 77, 15, { align: 'center', size: 6 });
        y += 12;
    });
};

const drawDocumentBox = (pdf, fattura) => {
    pdf.text(`Telefono Diretto ${companyConfig.phoneDirect}`, 321, 276, { align: 'center', color: RED, font: 'bold', size: 11, width: 250 });
    pdf.rect(321, 292, 250, 75, { fill: GRAY, stroke: BLACK });
    pdf.line(321, 329, 571, 329, { color: BLACK, lineWidth: 0.4 });
    pdf.line(321, 348, 571, 348, { color: BLACK, lineWidth: 0.4 });
    pdf.line(384, 329, 384, 367, { color: BLACK, lineWidth: 0.4 });
    pdf.line(446, 348, 446, 367, { color: BLACK, lineWidth: 0.4 });
    pdf.cellText('BOLLETTA PER LA FORNITURA DI ACQUA', 321, 296, 250, 17, { align: 'center', font: 'bold', size: 10 });
    pdf.cellText(fattura.tipo_documento || 'FATTURA', 321, 312, 250, 17, { align: 'center', font: 'bold', size: 10 });
    pdf.cellText('Data', 321, 329, 63, 19, { align: 'center', font: 'bold', size: 8 });
    pdf.cellText(formatDate(fattura.data_fattura), 384, 329, 187, 19, { align: 'center', font: 'bold', size: 8 });
    pdf.cellText('Anno', 321, 348, 63, 19, { align: 'center', font: 'bold', size: 8 });
    pdf.cellText(fattura.anno || '', 384, 348, 62, 19, { align: 'center', font: 'bold', size: 8 });
    pdf.cellText('Doc. Numero', 446, 348, 79, 19, { align: 'center', font: 'bold', size: 8 });
    pdf.cellText(fattura.numero ?? '', 525, 348, 46, 19, { align: 'center', font: 'bold', size: 8 });
    pdf.rect(321, 370, 119, 24, { fill: GRAY, stroke: BLACK });
    pdf.rect(440, 370, 131, 24, { fill: GRAY, stroke: BLACK });
    pdf.cellText('TOTALE DA PAGARE:', 321, 370, 119, 24, { align: 'center', font: 'bold', size: 8 });
    pdf.cellText(formatMoney(fattura.totale_fattura), 440, 370, 131, 24, { align: 'center', font: 'bold', size: 14 });
};

const drawPayment = (pdf, fattura, scadenza) => {
    pdf.rect(20, 360, 109, 20, { fill: LIGHT_GRAY, stroke: BLACK });
    pdf.rect(134, 360, 149, 20, { fill: GRAY, stroke: BLACK });
    pdf.cellText('Data Scadenza:', 20, 360, 109, 20, { align: 'center', font: 'bold', size: 8 });
    pdf.cellText(formatDate(scadenza?.scadenza || fattura.data_fattura), 134, 360, 149, 20, { align: 'center', font: 'bold', size: 8 });
    pdf.text('Bonifico presso:', 21, 400, { font: 'bold', size: 8 });
    pdf.text(`${companyConfig.bankName}    IBAN:   ${companyConfig.iban}`, 21, 424, { font: 'bold', size: 8 });
};

const getCounterLabel = (service) => (
    service.lettura?.contatore?.seriale
    || service.lettura?.contatore?.seriale_interno
    || service.calcolo_snapshot?.contatore?.seriale
    || service.seriale_condominio
    || ''
);

const getLineDescription = (service) => (
    service.descrizione
    || service.calcolo_snapshot?.articolo?.descrizione
    || service.articolo?.descrizione
    || ''
);

const drawDetailTable = (pdf, servizi) => {
    const tableX = 21;
    const tableWidth = 548;
    const columns = [
        { label: 'Tipo', width: 36, align: 'center' },
        { label: 'Contatore', width: 46, align: 'center' },
        { label: 'Descrizione', width: 118, align: 'left' },
        { label: 'IVA', width: 52, align: 'center' },
        { label: 'Lett. prec.', width: 46, align: 'center' },
        { label: 'Lett. att.', width: 46, align: 'center' },
        { label: 'm3', width: 26, align: 'center' },
        { label: 'Prezzo', width: 48, align: 'center' },
        { label: 'Valore', width: 48, align: 'center' },
        { label: 'Data', width: 82, align: 'center' },
    ].reduce((items, column) => {
        const previous = items[items.length - 1];
        const x = previous ? previous.x + previous.width : tableX;
        return [...items, { ...column, x }];
    }, []);
    const drawVerticalLines = (top, height, color = BORDER_GRAY) => {
        columns.slice(1).forEach((column) => {
            pdf.line(column.x, top, column.x, top + height, { color, lineWidth: 0.25 });
        });
    };
    const drawHeader = (top) => {
        pdf.rect(tableX, top, tableWidth, 18, { fill: LIGHT_BLUE, stroke: BORDER_GRAY, lineWidth: 0.4 });
        drawVerticalLines(top, 18);
        columns.forEach((column) => {
            pdf.cellText(column.label, column.x, top, column.width, 18, {
                align: 'center',
                font: 'bold',
                size: 5.4,
            });
        });
    };
    let y = 445;

    pdf.text('Dettaglio:', 21, y, { font: 'bold', size: 8 });
    y += 15;
    drawHeader(y);
    y += 18;

    servizi.forEach((service, index) => {
        if (y > 790) {
            pdf.addPage();
            y = 28;
            drawHeader(y);
            y += 18;
        }

        const rowFill = index % 2 === 0 ? [0.99, 0.99, 0.99] : [1, 1, 1];
        const rowHeight = 24;
        const values = [
            service.tipo_quota || service.tipo_tariffa || '',
            getCounterLabel(service),
            getLineDescription(service),
            service.articolo?.iva || `IVA ${formatNumber(getVatRate(service))}%`,
            service.lettura_precedente || '',
            service.lettura_fatturazione || '',
            formatNumber(service.metri_cubi),
            formatMoney(service.prezzo),
            formatMoney(service.valore_unitario),
            formatDate(service.data_lettura),
        ];

        pdf.rect(tableX, y, tableWidth, rowHeight, { fill: rowFill, stroke: BORDER_GRAY, lineWidth: 0.3 });
        pdf.rect(columns[9].x, y, columns[9].width, rowHeight, { fill: LIGHT_BLUE, stroke: BORDER_GRAY, lineWidth: 0.3 });
        drawVerticalLines(y, rowHeight);
        columns.forEach((column, columnIndex) => {
            if (columnIndex === 2) {
                pdf.wrappedText(values[columnIndex], column.x + 3, y + 8, column.width - 6, { size: 5.3, lineHeight: 6 });
                return;
            }

            pdf.cellText(values[columnIndex], column.x, y, column.width, rowHeight, {
                align: column.align,
                font: columnIndex === 9 ? 'bold' : 'regular',
                size: columnIndex >= 7 ? 5.2 : 5.4,
            });
        });
        y += rowHeight;
    });

    return y;
};

const drawFooter = (pdf) => {
    const y = 820;
    pdf.text(companyConfig.footer, 20, y, { font: 'bold', size: 5.8 });
    pdf.text(`${companyConfig.website} - ${companyConfig.email}`, 195, y + 10, { font: 'bold', size: 5.8 });
};

const loadInvoicePdfData = async (fatturaId) => {
    const fattura = await Fattura.findById(fatturaId).populate('cliente scadenza').lean();
    if (!fattura) {
        const error = new Error('Fattura not found');
        error.status = 404;
        throw error;
    }

    const servizi = await Servizio.find({ fattura: fatturaId })
        .sort({ riga: 1, _id: 1 })
        .populate([
            { path: 'articolo' },
            { path: 'listino' },
            { path: 'fascia' },
            { path: 'lettura', populate: { path: 'contatore' } },
        ])
        .lean();

    return {
        fattura,
        servizi,
    };
};

const generateInvoicePdf = async (fatturaId) => {
    const { fattura, servizi } = await loadInvoicePdfData(fatturaId);
    const pdf = new PdfDocument();

    registerInvoiceAssets(pdf);
    drawCompanyHeader(pdf);
    drawCustomerBox(pdf, fattura, fattura.cliente);
    drawPhoneBoxes(pdf);
    drawTaxSummary(pdf, fattura, servizi);
    drawDocumentBox(pdf, fattura);
    drawPayment(pdf, fattura, fattura.scadenza);
    drawDetailTable(pdf, servizi);
    drawFooter(pdf);

    return {
        buffer: pdf.toBuffer(),
        filename: `fattura-${invoiceCode(fattura) || fattura._id}.pdf`,
    };
};

module.exports = {
    generateInvoicePdf,
};
