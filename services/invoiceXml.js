// Fattura elettronica: costruzione del tracciato FatturaPA 1.2.
//
// Il file prodotto e lo stesso in ogni scenario di invio - portale dell'Agenzia,
// commercialista, intermediario accreditato - perche cambia solo come viene
// trasmesso, non cosa contiene. Per questo la generazione e separata dall'invio.
//
// Dove il tracciato richiede una scelta fiscale (regime, natura delle righe
// senza imposta) la scelta e dichiarata in config/invoicing.js e non indovinata
// qui: una fattura formalmente valida ma fiscalmente sbagliata e peggio di una
// che non viene generata.

const { CEDENTE, invoiceCode, naturaPerIva, tipoDocumentoXml } = require('../config/invoicing');
const { CODICE_DESTINATARIO_ASSENTE, codiceDestinatarioValido } = require('../config/delivery');
const { customerLabel } = require('../utils/customer');
const { getTaxRate } = require('./billingCalculator');
const { fromCents, toCents } = require('../utils/money');
const { unprocessable } = require('../utils/errors');
const { siglaProvincia } = require('../utils/province');

const FORMATO_PRIVATI = 'FPR12';

// Il tracciato accetta solo alcuni caratteri: niente accenti nei campi liberi.
const testoXml = (valore) => String(valore ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();

const importo = (valore) => fromCents(toCents(valore)).toFixed(2);
const percentuale = (valore) => Number(valore || 0).toFixed(2);

const dataIso = (valore) => {
    const data = valore ? new Date(valore) : null;
    return data && !Number.isNaN(data.getTime()) ? data.toISOString().slice(0, 10) : null;
};

const tag = (nome, valore) => (
    valore === undefined || valore === null || valore === ''
        ? ''
        : `<${nome}>${testoXml(valore)}</${nome}>`
);

// Il progressivo di invio identifica il file, non la fattura: due invii della
// stessa fattura devono avere progressivi diversi.
const progressivoInvio = (fattura) => (
    `${fattura.anno || ''}${String(fattura.numero || '0').padStart(5, '0')}`.slice(-10)
);

const nomeFile = (fattura) => (
    `IT${CEDENTE.partitaIva}_${progressivoInvio(fattura)}.xml`
);

const anagraficaCliente = (cliente, fattura) => {
    const denominazione = customerLabel(cliente, fattura);
    const partitaIva = cliente?.partita_iva;
    const codiceFiscale = cliente?.codice_fiscale;

    if (!denominazione) {
        throw unprocessable('Il cliente non ha una denominazione: impossibile emettere la fattura elettronica.');
    }

    if (!partitaIva && !codiceFiscale) {
        throw unprocessable(
            `Il cliente ${denominazione} non ha partita IVA ne codice fiscale: `
            + 'la fattura elettronica non puo essere emessa.'
        );
    }

    return { denominazione, partitaIva, codiceFiscale };
};

const indirizzoCliente = (cliente) => ({
    indirizzo: cliente?.indirizzo_fatturazione || cliente?.indirizzo_residenza,
    numero: cliente?.numero_fatturazione || cliente?.numero_residenza,
    cap: cliente?.cap_fatturazione || cliente?.cap_residenza,
    comune: cliente?.localita_fatturazione || cliente?.localita_residenza,
    // Il tracciato vuole la sigla di due lettere: l'anagrafica importata
    // contiene il nome esteso.
    provincia: siglaProvincia(cliente?.provincia_fatturazione || cliente?.provincia_residenza),
});

// Ogni riga porta la propria aliquota; le righe senza imposta devono dichiarare
// una natura, altrimenti il file viene scartato dal Sistema di Interscambio.
const rigaDettaglio = (servizio, indice) => {
    const aliquota = getTaxRate(servizio.articolo);
    const natura = aliquota === 0 ? naturaPerIva(servizio.articolo?.iva) : null;

    if (aliquota === 0 && !natura) {
        throw unprocessable(
            `La riga "${servizio.descrizione || servizio.articolo?.codice}" ha IVA a zero `
            + `("${servizio.articolo?.iva || 'non indicata'}") ma nessuna natura corrispondente. `
            + 'Aggiungere la corrispondenza in config/invoicing.js prima di emettere.'
        );
    }

    const quantita = Number(servizio.metri_cubi);
    const prezzo = Number(servizio.prezzo);

    return [
        '      <DettaglioLinee>',
        `        <NumeroLinea>${indice + 1}</NumeroLinea>`,
        `        ${tag('Descrizione', servizio.descrizione || servizio.articolo?.descrizione || 'Servizio')}`,
        Number.isFinite(quantita) && quantita > 0 ? `        <Quantita>${quantita.toFixed(2)}</Quantita>` : '',
        Number.isFinite(prezzo) ? `        <PrezzoUnitario>${importo(prezzo)}</PrezzoUnitario>` : '',
        `        <PrezzoTotale>${importo(servizio.valore_unitario)}</PrezzoTotale>`,
        `        <AliquotaIVA>${percentuale(aliquota)}</AliquotaIVA>`,
        natura ? `        <Natura>${natura}</Natura>` : '',
        '      </DettaglioLinee>',
    ].filter(Boolean).join('\n');
};

// Il riepilogo raggruppa per aliquota: e la sezione su cui l'Agenzia verifica i totali.
const righeRiepilogo = (servizi) => {
    const gruppi = new Map();

    servizi.forEach((servizio) => {
        const aliquota = getTaxRate(servizio.articolo);
        const natura = aliquota === 0 ? naturaPerIva(servizio.articolo?.iva) : null;
        const chiave = `${aliquota}|${natura || ''}`;
        const corrente = gruppi.get(chiave) || { aliquota, natura, centesimi: 0 };

        corrente.centesimi += toCents(servizio.valore_unitario);
        gruppi.set(chiave, corrente);
    });

    return [...gruppi.values()].map(({ aliquota, natura, centesimi }) => {
        const imponibile = fromCents(centesimi);
        const imposta = fromCents(Math.round((centesimi * aliquota) / 100));

        return [
            '      <DatiRiepilogo>',
            `        <AliquotaIVA>${percentuale(aliquota)}</AliquotaIVA>`,
            natura ? `        <Natura>${natura}</Natura>` : '',
            `        <ImponibileImporto>${importo(imponibile)}</ImponibileImporto>`,
            `        <Imposta>${importo(imposta)}</Imposta>`,
            natura ? '        <RiferimentoNormativo>Operazione senza applicazione IVA</RiferimentoNormativo>' : '',
            '      </DatiRiepilogo>',
        ].filter(Boolean).join('\n');
    });
};

const buildInvoiceXml = ({ cliente, fattura, servizi }) => {
    if (!servizi?.length) {
        throw unprocessable('La fattura non ha righe: impossibile emettere la fattura elettronica.');
    }

    const data = dataIso(fattura.data_fattura);
    if (!data) {
        throw unprocessable('La fattura non ha una data valida.');
    }

    const anagrafica = anagraficaCliente(cliente, fattura);
    const sede = indirizzoCliente(cliente);
    // Lo stesso criterio con cui si sceglie il canale della consegna: un codice
    // malformato non va scritto nel tracciato, vale come codice assente.
    const destinatario = codiceDestinatarioValido(cliente?.codice_destinatario)
        || CODICE_DESTINATARIO_ASSENTE;
    const numero = invoiceCode(fattura) || `${fattura.anno}/${fattura.numero}`;

    const tipoDocumento = tipoDocumentoXml(fattura.tipo_documento);
    if (!tipoDocumento) {
        throw unprocessable(
            `Tipo documento non riconosciuto: "${fattura.tipo_documento}". `
            + 'Il tracciato richiede di dichiararlo (fattura, nota di credito, nota di debito).'
        );
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="${FORMATO_PRIVATI}" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${testoXml(CEDENTE.partitaIva)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${progressivoInvio(fattura)}</ProgressivoInvio>
      <FormatoTrasmissione>${FORMATO_PRIVATI}</FormatoTrasmissione>
      <CodiceDestinatario>${testoXml(destinatario)}</CodiceDestinatario>
      ${cliente?.email_pec ? tag('PECDestinatario', cliente.email_pec) : ''}
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${testoXml(CEDENTE.partitaIva)}</IdCodice>
        </IdFiscaleIVA>
        ${tag('CodiceFiscale', CEDENTE.codiceFiscale)}
        <Anagrafica>
          ${tag('Denominazione', CEDENTE.denominazione)}
        </Anagrafica>
        <RegimeFiscale>${testoXml(CEDENTE.regimeFiscale)}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        ${tag('Indirizzo', CEDENTE.indirizzo)}
        ${tag('CAP', CEDENTE.cap)}
        ${tag('Comune', CEDENTE.comune)}
        ${tag('Provincia', CEDENTE.provincia)}
        <Nazione>${CEDENTE.nazione}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        ${anagrafica.partitaIva ? `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${testoXml(anagrafica.partitaIva)}</IdCodice></IdFiscaleIVA>` : ''}
        ${tag('CodiceFiscale', anagrafica.codiceFiscale)}
        <Anagrafica>
          ${tag('Denominazione', anagrafica.denominazione)}
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        ${tag('Indirizzo', [sede.indirizzo, sede.numero].filter(Boolean).join(' '))}
        ${tag('CAP', sede.cap)}
        ${tag('Comune', sede.comune)}
        ${tag('Provincia', sede.provincia)}
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>${tipoDocumento}</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${data}</Data>
        <Numero>${testoXml(numero)}</Numero>
        <ImportoTotaleDocumento>${importo(fattura.totale_fattura)}</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
${servizi.map(rigaDettaglio).join('\n')}
${righeRiepilogo(servizi).join('\n')}
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
`;

    // Righe vuote lasciate dai campi facoltativi assenti.
    return { filename: nomeFile(fattura), xml: xml.replace(/^\s*\n/gm, '') };
};

module.exports = {
    buildInvoiceXml,
    progressivoInvio,
};
