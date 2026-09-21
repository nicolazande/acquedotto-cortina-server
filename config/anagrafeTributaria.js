// I dati dell'acquedotto che aprono e chiudono l'elenco per l'anagrafe
// tributaria. Sono valori assegnati dall'Agenzia e non si deducono da nulla:
// stanno qui perche cambiarli non richieda di toccare il codice che compone le
// righe, e perche si veda a colpo d'occhio cosa va aggiornato se cambiano.
//
// Ricavati dal file prodotto dal gestionale precedente per il 2026.
const { AZIENDA } = require('./azienda');

module.exports = {
    codiceFornitura: 'IDR00240',
    // Chi manda l'elenco e chi emette le fatture sono lo stesso soggetto: i dati
    // vengono dal profilo dell'azienda, non da una seconda copia qui.
    partitaIva: AZIENDA.partitaIva,
    denominazione: AZIENDA.denominazione,
    comune: AZIENDA.sede.comune,
    provincia: AZIENDA.sede.provincia,
    // Accompagna l'anno nella riga di testa. Undici cifre come un codice fiscale
    // di societa, e non e quello dell'acquedotto: sembra il codice di chi
    // trasmette la fornitura. Resta uguale a ogni invio.
    progressivoFornitura: '00705780252',
    // L'ultimo codice di invio prodotto dal gestionale precedente, il 28/02/2026.
    // Non e un valore fisso: il codice cambia a ogni file prodotto, anche quando
    // lo stesso elenco viene ristampato dopo una correzione. Serve solo a far
    // ripartire il nostro contatore da dove l'aveva lasciato lui.
    ultimoCodiceInvio: '21004128022026',
};
