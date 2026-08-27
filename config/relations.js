// Chi dipende da chi, e cosa succede quando si cancella.
//
// MongoDB non ha vincoli di integrita referenziale: se si cancella un cliente,
// le sue fatture restano li a puntare a un documento che non esiste piu, e
// nessuno lo segnala. Il controllo va fatto dall'applicazione, e va fatto in un
// posto solo - altrimenti ogni risorsa se lo ricorda a modo suo, e qualcuna se
// lo dimentica.
//
// La politica usa il vocabolario che usano tutti (Prisma, Doctrine, SQL):
//
//   blocca   la cancellazione e rifiutata finche esistono documenti collegati.
//            E il caso normale per le anagrafiche: un cliente con fatture non
//            si cancella, si corregge. E anche cio che fa il gestionale
//            precedente, che su clienti, listini, articoli ed edifici non offre
//            proprio il pulsante di eliminazione.
//
//   conserva il documento collegato resta, e il riferimento puo restare
//            appeso. Serve solo dove il collegato tiene gia la sua copia di
//            cio che gli serve: il giornale delle modifiche salva il nome e il
//            ruolo di chi ha agito accanto al riferimento all'utente, proprio
//            perche un registro deve sopravvivere alla cancellazione di chi vi
//            compare. Per queste il rapporto di integrita non segnala il
//            riferimento appeso: e voluto, non un difetto.
//
//   cascata  i documenti collegati vengono cancellati insieme al padre, perche
//            senza di lui non significano niente: le righe di una fattura, le
//            sue consegne, le fasce di un listino.
//
// La stessa dichiarazione serve a due cose: impedire la cancellazione sbagliata
// e permettere al rapporto di integrita di verificare tutti i legami senza
// riscriverli a mano.

// Legami in entrata, per collezione: chi punta a questo documento.
const DIPENDENZE = {
    Articolo: [
        { modello: 'Servizio', campo: 'articolo', politica: 'blocca', descrizione: 'righe di fattura' },
    ],
    Cliente: [
        { modello: 'Fattura', campo: 'cliente', politica: 'blocca', descrizione: 'fatture' },
        { modello: 'Contatore', campo: 'cliente', politica: 'blocca', descrizione: 'contatori' },
        { modello: 'Consegna', campo: 'cliente', politica: 'blocca', descrizione: 'consegne' },
        { modello: 'User', campo: 'cliente', politica: 'blocca', descrizione: 'accessi al portale' },
    ],
    Contatore: [
        { modello: 'Lettura', campo: 'contatore', politica: 'blocca', descrizione: 'letture' },
    ],
    Edificio: [
        { modello: 'Contatore', campo: 'edificio', politica: 'blocca', descrizione: 'contatori' },
    ],
    Fascia: [
        { modello: 'Servizio', campo: 'fascia', politica: 'blocca', descrizione: 'righe di fattura' },
    ],
    Fattura: [
        // La cancellazione di una fattura passa da invoiceDeletionService, che
        // oltre a queste sblocca anche le letture: qui la dichiarazione serve al
        // rapporto di integrita.
        { modello: 'Servizio', campo: 'fattura', politica: 'cascata', descrizione: 'righe di fattura' },
        { modello: 'Consegna', campo: 'fattura', politica: 'cascata', descrizione: 'consegne' },
    ],
    Lettura: [
        { modello: 'Servizio', campo: 'lettura', politica: 'blocca', descrizione: 'righe di fattura' },
    ],
    Listino: [
        { modello: 'Contatore', campo: 'listino', politica: 'blocca', descrizione: 'contatori' },
        { modello: 'Servizio', campo: 'listino', politica: 'blocca', descrizione: 'righe di fattura' },
        { modello: 'Fascia', campo: 'listino', politica: 'cascata', descrizione: 'fasce' },
    ],
    Scadenza: [
        { modello: 'Fattura', campo: 'scadenza', politica: 'blocca', descrizione: 'fatture' },
    ],
    User: [
        { modello: 'AuditLog', campo: 'actor', politica: 'conserva', descrizione: 'voci del giornale' },
    ],
};

const dipendenzeDi = (modello) => DIPENDENZE[modello] || [];

// Tutti i legami dichiarati, in forma piatta: il rapporto di integrita li
// percorre uno per uno.
const TUTTI_I_LEGAMI = Object.entries(DIPENDENZE).flatMap(([bersaglio, archi]) => (
    archi.map((arco) => ({ ...arco, bersaglio }))
));

module.exports = {
    DIPENDENZE,
    TUTTI_I_LEGAMI,
    dipendenzeDi,
};
