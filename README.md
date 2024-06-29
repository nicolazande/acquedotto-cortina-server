# Gestione Acquedotto di Zuel

## Descrizione del Progetto

Il progetto di Gestione Acquedotto di Zuel è un'applicazione web dedicata alla gestione e monitoraggio dell'acquedotto nel comune di Zuel. L'applicazione consente agli utenti autorizzati di monitorare lo stato del sistema idrico, registrare e gestire reclami, visualizzare statistiche sull'utilizzo dell'acqua, e ricevere notifiche in tempo reale riguardanti guasti o problemi.

### Funzionalità Principali:

- **Dashboard di Monitoraggio**: Visualizzazione in tempo reale dello stato del sistema idrico, comprese le informazioni sui livelli di acqua, la pressione nei tubi e i consumi giornalieri.
  
- **Gestione dei Reclami**: Utenti e amministratori possono registrare e monitorare reclami riguardanti perdite d'acqua, malfunzionamenti nei rubinetti, o qualunque altra problematica.

- **Statistiche e Report**: Generazione di report periodici sull'utilizzo dell'acqua, confronto tra consumi di diverse zone, e analisi delle tendenze nel tempo.

- **Notifiche in Tempo Reale**: Ricezione di avvisi immediati su guasti o emergenze attraverso notifiche push integrate.

### Tecnologie Utilizzate:

- **Frontend**: React, React Router DOM per la gestione del routing, Axios per le chiamate API.
  
- **Backend**: Node.js con Express per il server HTTP, MongoDB per il database, Mongoose per l'ODM.

- **Autenticazione e Autorizzazione**: JWT (JSON Web Tokens) per la gestione dell'autenticazione utente.

### Installazione e Avvio:

Per installare e avviare il progetto localmente:

1. Clona il repository:

   ```bash
   git clone https://github.com/tuonomeutente/gestione-acquedotto-zuel.git
   cd gestione-acquedotto-zuel
