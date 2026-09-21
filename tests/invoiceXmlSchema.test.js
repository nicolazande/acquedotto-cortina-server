const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildInvoiceXml } = require('../services/invoiceXml');

// Il file lo giudica il Sistema di Interscambio, che lo passa allo schema
// ufficiale: un elemento fuori ordine o un campo di troppo lo fa scartare, e lo
// si scopre dopo averlo mandato. Qui lo schema e lo stesso, preso da
// fatturapa.gov.it (v1.2.2, namespace v1.2), e il giudizio arriva subito.
//
// Serve `xmllint` (pacchetto libxml2-utils): dove non c'e, la prova si salta
// invece di fallire - non tutti gli ambienti lo hanno, e un test rosso per un
// programma mancante non dice niente sul codice.
const SCHEMA = path.join(__dirname, 'fatturapa-v1.2.xsd');
const xmllintDisponibile = spawnSync('xmllint', ['--version']).error === undefined;

const cliente = {
    ragione_sociale: 'Termoidraulica Rossi',
    partita_iva: '00839940251',
    codice_fiscale: 'RSSMRA65L31G642I',
    codice_destinatario: 'TULURSB',
    indirizzo_residenza: 'Via Roma',
    numero_residenza: '12',
    cap_residenza: '32043',
    localita_residenza: 'Cortina',
    provincia_residenza: 'Belluno',
};

const fattura = {
    anno: 2026, numero: 7, serie: 'A',
    tipo_documento: 'Fattura',
    data_fattura: new Date('2026-06-15T00:00:00.000Z'),
    totale_fattura: 71.34,
};

// Tre righe che coprono i casi che cambiano il tracciato: consumo, quota fissa
// e una riga esente, che porta con se natura e riferimento normativo.
const servizi = [
    { riga: 1, descrizione: 'Consumo acqua', metri_cubi: 10, prezzo: 0.74, valore_unitario: 7.4, articolo: { codice: 'ACQUA', iva: 'IVA 10%' } },
    { riga: 2, descrizione: 'Quota fissa', metri_cubi: 1, prezzo: 52, valore_unitario: 52, articolo: { codice: 'ACQUAF', iva: 'IVA 10%' } },
    { riga: 3, descrizione: 'Mora', metri_cubi: 1, prezzo: 6, valore_unitario: 6, articolo: { codice: 'GG_DELAY', iva: 'Esente art.15' } },
];

const scadenza = { scadenza: new Date('2026-07-15T00:00:00.000Z') };

const validaConLoSchema = (xml) => {
    const percorso = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fattura-')), 'fattura.xml');
    fs.writeFileSync(percorso, xml);

    try {
        const esito = spawnSync('xmllint', ['--noout', '--schema', SCHEMA, percorso], { encoding: 'utf8' });
        return { valido: esito.status === 0, motivo: esito.stderr };
    } finally {
        fs.rmSync(path.dirname(percorso), { recursive: true, force: true });
    }
};

const casi = {
    'una fattura con scadenza e bonifico': { cliente, fattura, servizi, scadenza },
    'una fattura senza scadenza': { cliente, fattura, servizi },
    'una fattura addebitata in conto': {
        cliente: { ...cliente, pagamento: 'Addebito in conto  a scadenza', iban: 'IT60X0542811101000000123456' },
        fattura,
        servizi,
        scadenza,
    },
    'una nota di credito': {
        cliente, servizi, scadenza,
        fattura: { ...fattura, tipo_documento: 'Nota di Credito' },
    },
};

Object.entries(casi).forEach(([nome, dati]) => {
    test(`${nome} e conforme allo schema dell'Agenzia`, { skip: xmllintDisponibile ? false : 'xmllint non disponibile' }, () => {
        const { valido, motivo } = validaConLoSchema(buildInvoiceXml(dati).xml);
        assert.ok(valido, motivo);
    });
});
