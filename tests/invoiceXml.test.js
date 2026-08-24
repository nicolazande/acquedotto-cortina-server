const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInvoiceXml, progressivoInvio } = require('../services/invoiceXml');
const { siglaProvincia } = require('../utils/province');
const { naturaPerIva, tipoDocumentoXml } = require('../config/invoicing');

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
    totale_fattura: 65.34,
};

const servizi = [
    { riga: 1, descrizione: 'Consumo acqua', metri_cubi: 10, prezzo: 0.74, valore_unitario: 7.4, articolo: { codice: 'ACQUA', iva: 'IVA 10%' } },
    { riga: 2, descrizione: 'Quota fissa', metri_cubi: 1, prezzo: 52, valore_unitario: 52, articolo: { codice: 'ACQUAF', iva: 'IVA 10%' } },
];

const genera = (override = {}) => buildInvoiceXml({ cliente, fattura, servizi, ...override });

test('produce un documento con la radice del tracciato FatturaPA', () => {
    const { xml } = genera();

    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<p:FatturaElettronica versione="FPR12"/);
    assert.match(xml, /xmlns:p="http:\/\/ivaservizi\.agenziaentrate\.gov\.it\/docs\/xsd\/fatture\/v1\.2"/);
});

test('il nome del file segue la convenzione IT<partitaIVA>_<progressivo>', () => {
    const { filename } = genera();

    assert.match(filename, /^IT\d{11}_\d+\.xml$/);
});

test('la provincia viene convertita in sigla', () => {
    // Il tracciato accetta solo due lettere; l'anagrafica importata ha il nome esteso.
    const { xml } = genera();

    assert.match(xml, /<Provincia>BL<\/Provincia>/);
    assert.doesNotMatch(xml, /<Provincia>Belluno<\/Provincia>/);
});

test('il codice destinatario del cliente finisce nella trasmissione', () => {
    assert.match(genera().xml, /<CodiceDestinatario>TULURSB<\/CodiceDestinatario>/);
});

test('senza codice destinatario si usa quello generico', () => {
    const { xml } = genera({ cliente: { ...cliente, codice_destinatario: '' } });

    assert.match(xml, /<CodiceDestinatario>0000000<\/CodiceDestinatario>/);
});

test('una fattura si dichiara TD01', () => {
    assert.match(genera().xml, /<TipoDocumento>TD01<\/TipoDocumento>/);
});

test('una nota di credito si dichiara TD04, non TD01', () => {
    // Emetterla come fattura significa dichiarare il contrario di quello che e:
    // lo SdI la accetta e il documento resta sbagliato.
    const { xml } = genera({ fattura: { ...fattura, tipo_documento: 'Nota di Credito' } });

    assert.match(xml, /<TipoDocumento>TD04<\/TipoDocumento>/);
});

test('un tipo documento sconosciuto blocca l emissione', () => {
    assert.throws(
        () => genera({ fattura: { ...fattura, tipo_documento: 'Preventivo' } }),
        /Tipo documento non riconosciuto/
    );
});

test('tipoDocumentoXml riconosce le scritture ricorrenti', () => {
    assert.equal(tipoDocumentoXml('Fattura'), 'TD01');
    assert.equal(tipoDocumentoXml('FATTURA'), 'TD01');
    // Nessun documento importato ha il campo vuoto, ma se capitasse e una fattura.
    assert.equal(tipoDocumentoXml(''), 'TD01');
    assert.equal(tipoDocumentoXml('Nota di Credito'), 'TD04');
    assert.equal(tipoDocumentoXml('nota credito'), 'TD04');
    assert.equal(tipoDocumentoXml('Nota di Debito'), 'TD05');
    assert.equal(tipoDocumentoXml('Autofattura'), null);
});

test('un codice destinatario malformato vale come assente', () => {
    // Lo stesso giudizio che decide il canale della consegna: se il codice non e
    // valido la fattura va nel cassetto fiscale, e il tracciato deve dire
    // altrettanto invece di trasportare un valore che lo SdI rifiuterebbe.
    const { xml } = genera({ cliente: { ...cliente, codice_destinatario: 'ABC' } });

    assert.match(xml, /<CodiceDestinatario>0000000<\/CodiceDestinatario>/);
});

test('il codice destinatario viaggia in maiuscolo', () => {
    const { xml } = genera({ cliente: { ...cliente, codice_destinatario: 'tulursb' } });

    assert.match(xml, /<CodiceDestinatario>TULURSB<\/CodiceDestinatario>/);
});

test('il riepilogo raggruppa per aliquota e i conti tornano', () => {
    const { xml } = genera();

    assert.match(xml, /<ImponibileImporto>59\.40<\/ImponibileImporto>/);
    assert.match(xml, /<Imposta>5\.94<\/Imposta>/);
    assert.match(xml, /<ImportoTotaleDocumento>65\.34<\/ImportoTotaleDocumento>/);
});

test('ogni riga porta numero, quantita, prezzo e aliquota', () => {
    const { xml } = genera();

    assert.match(xml, /<NumeroLinea>1<\/NumeroLinea>/);
    assert.match(xml, /<Quantita>10\.00<\/Quantita>/);
    assert.match(xml, /<PrezzoUnitario>0\.74<\/PrezzoUnitario>/);
    assert.match(xml, /<AliquotaIVA>10\.00<\/AliquotaIVA>/);
});

test('una riga senza imposta dichiara la natura', () => {
    const conEsente = [...servizi, {
        riga: 3, descrizione: 'Mora', metri_cubi: 1, prezzo: 6, valore_unitario: 6,
        articolo: { codice: 'GG_DELAY', iva: 'Esente art.15' },
    }];
    // 59,40 di imponibile al 10% piu 6,00 esenti: il totale del documento deve
    // seguire le righe, altrimenti e il controllo sul totale a fermare tutto.
    const { xml } = genera({ servizi: conEsente, fattura: { ...fattura, totale_fattura: 71.34 } });

    assert.match(xml, /<Natura>N1<\/Natura>/);
    assert.match(xml, /<RiferimentoNormativo>/);
});

test('una riga a zero senza natura nota blocca l emissione', () => {
    // Meglio non emettere che emettere un documento che il Sistema di
    // Interscambio scarterebbe, o peggio accetterebbe con la natura sbagliata.
    const ignota = [{ riga: 1, descrizione: 'Voce', valore_unitario: 10, articolo: { codice: 'X', iva: 'Regime speciale' } }];

    assert.throws(
        () => genera({ servizi: ignota, fattura: { ...fattura, totale_fattura: 10 } }),
        /nessuna natura corrispondente/
    );
});

test('un cliente senza partita IVA ne codice fiscale blocca l emissione', () => {
    const anonimo = { ragione_sociale: 'Senza dati' };

    assert.throws(() => genera({ cliente: anonimo }), /partita IVA ne codice fiscale/);
});

test('una fattura senza righe blocca l emissione', () => {
    assert.throws(() => genera({ servizi: [] }), /non ha righe/);
});

test('il progressivo di invio e stabile per la stessa fattura', () => {
    assert.equal(progressivoInvio(fattura), progressivoInvio(fattura));
    assert.notEqual(progressivoInvio(fattura), progressivoInvio({ ...fattura, numero: 8 }));
});

test('le nature note sono quelle configurate', () => {
    assert.equal(naturaPerIva('Esente art.15'), 'N1');
    assert.equal(naturaPerIva('Codice iva Art.26 DPR 633/72 Comma 3'), 'N2.2');
    assert.equal(naturaPerIva('NI90'), 'N3.5');
    assert.equal(naturaPerIva('IVA 10%'), null);
});

test('siglaProvincia riconosce nomi, sigle e valori non applicabili', () => {
    assert.equal(siglaProvincia('Belluno'), 'BL');
    assert.equal(siglaProvincia('Monza e della Brianza'), 'MB');
    assert.equal(siglaProvincia('VE'), 'VE');
    assert.equal(siglaProvincia('- Nessuna -'), null);
    assert.equal(siglaProvincia('Stato Estero'), null);
    assert.equal(siglaProvincia(''), null);
});

test('il totale dichiarato deve coincidere con la somma dei riepiloghi', () => {
    // E il conto che rifa il Sistema di Interscambio: un centesimo di scarto
    // basta a far scartare il file. Su 135 fatture importate il totale salvato
    // dal gestionale precedente non torna con le proprie righe.
    assert.throws(
        () => genera({ fattura: { ...fattura, totale_fattura: 65.33 } }),
        /non coincide con la somma delle sue righe/
    );
    assert.throws(
        () => genera({ fattura: { ...fattura, totale_fattura: 65.35 } }),
        /Sistema di Interscambio rifiuterebbe il file/
    );
});

test('il totale scritto nel documento e quello dei suoi riepiloghi', () => {
    const { xml } = genera();
    const imponibile = [...xml.matchAll(/<ImponibileImporto>([\d.]+)</g)].map((m) => Number(m[1]));
    const imposta = [...xml.matchAll(/<Imposta>([\d.]+)</g)].map((m) => Number(m[1]));
    const somma = [...imponibile, ...imposta].reduce((t, v) => t + v, 0);
    const dichiarato = Number(xml.match(/<ImportoTotaleDocumento>([\d.]+)</)[1]);

    assert.equal(dichiarato, Number(somma.toFixed(2)));
    assert.equal(dichiarato, 65.34);
});
