// I dati dell'acquedotto che aprono e chiudono l'elenco per l'anagrafe
// tributaria. Sono valori assegnati dall'Agenzia e non si deducono da nulla:
// stanno qui perche cambiarli non richieda di toccare il codice che compone le
// righe, e perche si veda a colpo d'occhio cosa va aggiornato se cambiano.
//
// Ricavati dal file prodotto dal gestionale precedente per il 2026.
module.exports = {
    codiceFornitura: 'IDR00240',
    partitaIva: '00296800253',
    denominazione: 'COOPERATIVA  GESTIONE ACQUEDOTTO VICINIA DI ZUEL',
    comune: "CORTINA D'AMPEZZO",
    provincia: 'BL',
    // Progressivo della fornitura e codice di invio: accompagnano l'anno nella
    // riga di testa.
    progressivoFornitura: '00705780252',
    codiceInvio: '21004128022026',
};
