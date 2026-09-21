// Chi emette le fatture: un profilo solo, letto da tutti.
//
// Questi dati stavano scritti in tre posti - il tracciato elettronico, il PDF e
// l'elenco per l'anagrafe tributaria - e infatti la ragione sociale era diversa
// in uno: le fatture uscivano a nome "COOPERATIVA DI GESTIONE ACQUEDOTTO ZUEL DI
// SOPRA" mentre l'acquedotto ha sempre fatturato come "COOPERATIVA  GESTIONE
// ACQUEDOTTO VICINIA DI ZUEL" (il doppio spazio e nel nome, non un refuso).
// Tenerli qui significa che un dato dell'azienda si cambia in un punto e cambia
// ovunque compaia.
//
// I valori sono quelli con cui il gestionale precedente ha emesso le fatture
// elettroniche fino a settembre 2026, letti dal suo ultimo file.
const AZIENDA = {
    denominazione: process.env.INVOICE_COMPANY_NAME
        || 'COOPERATIVA  GESTIONE ACQUEDOTTO VICINIA DI ZUEL',
    partitaIva: process.env.INVOICE_VAT_NUMBER || '00296800253',
    codiceFiscale: process.env.INVOICE_TAX_CODE || '00296800253',
    // RF01 e il regime ordinario. Va confermato da chi tiene la contabilita:
    // un regime sbagliato rende la fattura non conforme.
    regimeFiscale: process.env.INVOICE_TAX_REGIME || 'RF01',

    sede: {
        indirizzo: process.env.INVOICE_ADDRESS || 'Pian Da Lago',
        // Il tracciato vuole il civico separato dalla via.
        civico: process.env.INVOICE_STREET_NUMBER || '64',
        cap: process.env.INVOICE_ZIP || '32043',
        comune: process.env.INVOICE_CITY || "CORTINA D'AMPEZZO",
        provincia: process.env.INVOICE_PROVINCE || 'BL',
        nazione: 'IT',
    },

    // Iscrizione al registro delle imprese. La fattura elettronica la porta
    // perche una societa iscritta deve dichiararla sui propri documenti.
    rea: {
        ufficio: process.env.INVOICE_REA_OFFICE || 'BL',
        numero: process.env.INVOICE_REA_NUMBER || '65393',
        capitaleSociale: process.env.INVOICE_SHARE_CAPITAL || '18500.00',
        // LN = non in liquidazione.
        statoLiquidazione: process.env.INVOICE_LIQUIDATION_STATE || 'LN',
    },

    contatti: {
        // Senza spazi: e il formato che vuole il tracciato. Il PDF lo spazia.
        telefono: process.env.INVOICE_PHONE || '0436867504',
        email: process.env.INVOICE_COMPANY_EMAIL || 'acquedottozuel@gmail.com',
        sito: process.env.INVOICE_COMPANY_WEBSITE || 'www.acquedottozuel.it',
    },

    // Dove il cliente paga. ABI e CAB non si scrivono: stanno dentro l'IBAN, e
    // copiarli a mano sarebbe un secondo posto dove possono sbagliarsi.
    banca: {
        istituto: process.env.INVOICE_BANK_NAME || 'CORTINA BANCA Credito cooperativo Italiano',
        iban: (process.env.INVOICE_IBAN || 'IT11M0851161070000000006953').replace(/\s+/g, ''),
    },
};

// L'IBAN italiano porta l'ABI dal quinto carattere e il CAB dal decimo.
const abiDellIban = (iban) => String(iban || '').slice(5, 10);
const cabDellIban = (iban) => String(iban || '').slice(10, 15);

module.exports = { AZIENDA, abiDellIban, cabDellIban };
