# Acquedotto Cortina - Server

Questo repository contiene il server Node.js per il progetto Acquedotto Cortina, che gestisce la logica di business e l'interazione con il database MongoDB.

## Descrizione

Acquedotto Cortina è un'applicazione che consente agli utenti di registrare, visualizzare e gestire i dati relativi agli utenti e alle loro posizioni su una mappa interattiva. Il server fornisce API per consentire al client di comunicare con il database e gestire le operazioni CRUD sugli utenti.

## Tecnologie Utilizzate

- **Server**: Node.js, Express
- **Database**: MongoDB tramite Mongoose
- **Altri**: Dotenv (per gestire le variabili d'ambiente), Multer (per il caricamento dei file)

## Struttura del Progetto

Il progetto del server è organizzato nelle seguenti cartelle principali:

- **controllers**: contiene i controller che gestiscono le richieste HTTP e la logica di business.
- **models**: definisce i modelli di dati utilizzati dal server per interagire con MongoDB tramite Mongoose.
- **routes**: definisce le rotte API per gestire le richieste HTTP dal client.
- **uploads**: cartella per memorizzare i file caricati dagli utenti.

## Installazione e Avvio del Server

Per installare e avviare il server sul tuo sistema locale, segui questi passaggi:

1. **Clona il repository**

   ```bash
   git clone <URL_DEL_REPO>
   cd server

2. ***Installazione delle dipendenze***

    Assicurati di avere Node.js installato sul tuo computer. Dopo aver navigato nella cartella server, esegui il seguente comando per installare tutte le dipendenze necessarie:

    ```bash
    npm install

3. ***Configurazione delle variabili d'ambiente***

    Assicurati di creare un file .env nella cartella server e di configurare le variabili d'ambiente necessarie. Ad esempio:

    ```bash
    PORT=5000
    MONGODB_URI=mongodb://localhost:27017/acquedotto-cortina

    Sostituisci mongodb://localhost:27017/acquedotto-cortina con l'URL della tua istanza MongoDB.

4. ***Avvio del server***

    Una volta completata la configurazione, puoi avviare il server con il seguente comando:

   ```bash
   npm start

    Questo avvierà il server Node.js. Assicurati che il server sia in esecuzione prima di avviare il client.
