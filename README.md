# Acquedotto Zuel - Server

Backend Express/Mongoose per il gestionale Acquedotto Zuel.

## Documentazione

| Documento | Contenuto |
|-----------|-----------|
| [docs/architettura.md](docs/architettura.md) | livelli, moduli e percorso di una richiesta |
| [docs/fatturazione.md](docs/fatturazione.md) | come si calcola una fattura, scaglione per scaglione |
| [docs/api.md](docs/api.md) | tutti gli endpoint, i parametri e i codici di stato |
| [docs/manutenzione.md](docs/manutenzione.md) | backup, controlli periodici, problemi noti |

## Avvio locale

```bash
npm install
npm run dev
```

In produzione:

```bash
npm start
```

Puoi usare anche lo script locale, che imposta automaticamente il Node incluso
nel workspace, crea `.env` da `.env.example` se manca e installa le dipendenze
se necessario:

```bash
./start-local.sh
```

Se vuoi far partire anche MongoDB locale via Docker:

```bash
START_MONGO=true ./start-local.sh
```

## Configurazione

Crea un file `.env` partendo da `.env.example`.

```bash
PORT=5000
MONGODB_URI=mongodb://localhost:27017/acquedotto-zuel
MONGODB_DB=acquedotto-zuel
JWT_SECRET=change-me
CLIENT_ORIGINS=http://localhost:3000,http://localhost:3001
```

`MONGODB_DB` e' opzionale se il nome database e' gia' nella URI, ma conviene impostarlo con provider remoti: molte URI Atlas copiate dalla dashboard non includono il database e senza questa variabile il driver userebbe un default non desiderato.

Esempio MongoDB Atlas:

```bash
MONGODB_URI=mongodb+srv://user:password@cluster.example.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=acquedotto-zuel
```

Se username o password contengono caratteri speciali, vanno URL-encoded nella URI. Per Atlas ricordati anche di consentire l'IP del server nelle regole Network Access.

Opzioni Mongo utili:

```bash
MONGODB_SERVER_SELECTION_TIMEOUT_MS=10000
MONGODB_SOCKET_TIMEOUT_MS=45000
MONGODB_MAX_POOL_SIZE=10
MONGODB_TLS=
MONGODB_TLS_ALLOW_INVALID_CERTIFICATES=false
MONGODB_DIRECT_CONNECTION=
```

`MONGODB_TLS` normalmente non serve con `mongodb+srv://`: il driver abilita TLS quando necessario. `MONGODB_TLS_ALLOW_INVALID_CERTIFICATES=true` va usato solo in ambienti controllati con certificati self-signed.

`CLIENT_ORIGINS` accetta piu' origini separate da virgola, ad esempio:

```bash
CLIENT_ORIGINS=https://app.example.com,https://preview.example.com
```

In ambienti dietro proxy/load balancer puoi impostare `TRUST_PROXY=true`.

## Allegati alle note

Gli allegati delle note sono salvati in MongoDB nella collection `note_attachments`, quindi funzionano sia in locale sia con MongoDB remoto senza dipendere dal filesystem del server.

Sono accettati immagini, PDF, TXT/CSV, documenti Word/Excel e formati OpenDocument. File HTML o eseguibili non sono ammessi.

Variabili utili:

```bash
REQUEST_BODY_LIMIT=10mb
ATTACHMENT_MAX_BYTES=6291456
```

`ATTACHMENT_MAX_BYTES` limita la dimensione di ogni allegato dopo l'eventuale compressione lato client.

## Fatturazione automatica

La generazione da letture passa dal servizio `services/invoiceGenerator.js` e dal calcolatore puro `services/billingCalculator.js`.

Endpoint principali:

```text
GET  /api/fatture/generazione/anteprima
POST /api/fatture/genera-da-letture
GET  /api/letture/:id/calcolo
GET  /api/fatture/:id/verifica-calcolo
GET  /api/fatture/:id/pdf
```

Le fatture generate salvano:

- numero progressivo per anno tramite `invoice_counters`
- riferimenti alle letture fatturate
- righe servizio con listino, fascia, aliquota IVA e snapshot del calcolo
- stato iniziale `bozza` o `confermata`

Su MongoDB con replica set o Atlas la generazione usa una transazione: fattura, righe servizio e flag `fatturata` delle letture vengono salvati insieme. Su MongoDB locale standalone il codice resta compatibile e usa un fallback non transazionale.

Il PDF fattura e' generato lato server senza servizi esterni. I testi aziendali e bancari si configurano con le variabili `INVOICE_COMPANY_*`, `INVOICE_PHONE_DIRECT`, `INVOICE_BANK_NAME` e `INVOICE_IBAN`.

## Struttura utile

- `server.js`: bootstrap Express, CORS, middleware globali e gestione errori
- `config/db.js`: connessione MongoDB
- `routes`: rotte HTTP divise per risorsa
- `controllers`: traduzione fra HTTP e dominio
- `controllers/utils/controllerActions.js`: fabbriche CRUD condivise
- `controllers/utils/paginatedQuery.js`: paginazione, ricerca e ordinamento condivisi
- `services`: le regole (fatturazione, PDF, scadenze, audit)
- `utils`: funzioni pure condivise (numeri, date, errori, helper Mongo)
- `models`: schemi Mongoose e indici
- `middlewares/AuthMiddleware.js`: verifica JWT per le rotte protette

Dettaglio in [docs/architettura.md](docs/architettura.md).

## Sessione e utenti

```bash
JWT_EXPIRES_IN=8h
MAX_ADMIN_USERS=2
```

`JWT_EXPIRES_IN` regola la durata del token (non esiste rinnovo automatico:
alla scadenza serve un nuovo login). `MAX_ADMIN_USERS` limita la registrazione
libera di amministratori; gli account del portale clienti non rientrano nel
conteggio e si creano dalla scheda cliente.

Tutti gli esiti di autenticazione fallita rispondono `401` con un campo `reason`
(`missing_token`, `token_expired`, `invalid_token`, `user_not_found`), cosi il
client puo riportare l'utente al login spiegando il motivo.

## Cancellazione fatture

`DELETE /api/fatture/:id` cancella la fattura **insieme a** le sue righe servizio
e alla scadenza generata con lei, e riporta le letture collegate fra quelle
fatturabili. Le fatture confermate restano non cancellabili.

## Endpoint salute

```text
GET /api/auth/health
```

Risponde `200` con database connesso:

```json
{ "status": "ok", "database": "connected" }
```

Risponde `503` se Express e' raggiungibile ma MongoDB non e' connesso.

## Test

```bash
npm test        # test unitari (node --test), non toccano il database
npm run lint    # controllo statico
```

I test unitari coprono il calcolatore di fatturazione, l'aritmetica monetaria,
le scadenze e le funzioni condivise. Sono la rete di sicurezza da eseguire
prima di toccare il calcolo.

Attenzione alla differenza fra i due gruppi di script:

| Comando | Cosa fa |
|---------|---------|
| `npm test`, `npm run test:smoke` | **test veri**: falliscono con codice di uscita diverso da zero |
| `npm run report:*` | **rapporti** sui dati reali: stampano cosa trovano. `report:tutti` li esegue in fila |
| `npm run verify:*`, `report:calcolo*`, `report:integrita` | **rapporti** sui dati reali: stampano le anomalie ma escono sempre con 0 |

## Installazione da zero

Su un database vuoto vanno creati gli articoli obbligatori, altrimenti la
generazione fattura si ferma perche non riesce a determinare l'aliquota IVA:

```bash
npm run seed:articoli
```

## Manutenzione dei dati

```bash
npm run maintenance:allinea-dati         # elenca cosa non e coerente
npm run maintenance:allinea-dati -- --fix # applica le correzioni
```

Allinea `stato` e `confermata` sulle fatture e rimuove dalle scadenze il campo
`ritardo`, che e un valore derivato e viene ricalcolato a ogni lettura.

## Smoke check

Per verificare API, MongoDB, liste paginate, fatturazione e allegati:

```bash
npm run test:smoke
```

Di default il test usa `http://localhost:5000/api`. Per un server remoto:

```bash
SMOKE_API_URL=https://api.example.com npm run test:smoke
```

Render:

```bash
SMOKE_API_URL=https://acquedotto-cortina-server.onrender.com npm run test:smoke
```

Lo smoke test richiede le credenziali di un amministratore (`SMOKE_USERNAME` e
`SMOKE_PASSWORD`) oppure un token gia pronto in `SMOKE_TOKEN`.

Il test crea e cancella i propri record temporanei, comprese una bozza fattura e
piccoli allegati su un cliente esistente. Per controlli read-only:

```bash
SMOKE_SKIP_MUTATION=true npm run test:smoke
```

Per confrontare il calcolo attuale con le righe storiche importate:

```bash
npm run report:calcolo
```

## Import dati

### Il login e separato dall'import

Il login a Gesco richiede una persona: il CAPTCHA va risolto a mano. Per questo
e un comando a se.

```bash
npm run gesco:login    # apre il browser, attende il CAPTCHA, salva la sessione
npm run gesco:import   # scarica i dati, senza interazione
```

La sessione finisce in `.fasttools-session` (escluso da git) e vale finche resta
valida su Gesco: nel frattempo l'import si puo ripetere o riprendere senza nuovi
CAPTCHA.

### Rete di sicurezza dell'import

| Comportamento | Perche |
|---------------|--------|
| Con `IMPORT_RESET_DB` fa un **backup automatico** in `backups/before-import-<data>/` prima di svuotare | un import interrotto a meta lascerebbe il database vuoto. Si ripristina con `restore_backup.py`, si salta con `IMPORT_SKIP_BACKUP=1` |
| **Fallisce** se un passo non importa nulla | con la sessione scaduta le pagine rispondono vuote: prima concludeva "processed" senza aver scaricato niente, uscendo con successo |
| **Chiede conferma** se il database non e locale | lo stesso comando punta al database indicato da `MONGODB_URI`. Si salta con `IMPORT_ASSUME_YES=1` |
| Stampa un **riepilogo** prima/dopo per collection | prima non si sapeva se avesse importato tutto, una parte o niente |
| **Riusa la sessione** salvata in `.fasttools-session` | il login ha un CAPTCHA manuale: senza riuso ogni ripresa ne richiede un altro |

Ripristino di un backup:

```bash
.venv/bin/python documents/script/restore_backup.py backups/before-import-20260820-120000
.venv/bin/python documents/script/restore_backup.py backups/before-import-20260820-120000 --conferma
```

Senza `--conferma` lo script si limita a elencare cosa farebbe.

Lo script in `documents/script/main.py` usa le stesse variabili MongoDB del server, quindi puo' importare anche su MongoDB remoto:

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python documents/script/main.py
```

Per Atlas usa `pymongo[srv]`, gia' incluso in `requirements.txt`.

Puoi limitare l'import a una o piu' sezioni:

```bash
IMPORT_STEPS=listini,articoli,clienti
```

Valori disponibili: `listini`, `articoli`, `clienti`, `edifici`, `scadenze`, `fatture`.

Per ambienti lenti o database remoti puoi ridurre il parallelismo:

```bash
FASTTOOLS_TIMEOUT_SECONDS=60
IMPORT_CLIENTI_WORKERS=10
IMPORT_EDIFICI_WORKERS=10
IMPORT_FATTURE_WORKERS=10
```

## Sincronizzazione locale/remoto

Lo script `documents/script/sync_databases.py` copia velocemente le collection applicative tra MongoDB remoto e locale usando bulk upsert.

Esempio per scaricare il remoto in locale:

```bash
REMOTE_MONGODB_URI=mongodb+srv://user:password@cluster.example.mongodb.net/?retryWrites=true&w=majority
REMOTE_MONGODB_DB=acquedotto-zuel
.venv/bin/python documents/script/sync_databases.py --direction pull
```

Esempio per inviare il locale al remoto:

```bash
.venv/bin/python documents/script/sync_databases.py --direction push
```

Per fare una copia speculare, eliminando dal target i documenti non presenti nella sorgente:

```bash
.venv/bin/python documents/script/sync_databases.py --direction pull --delete-missing
```

Prima di una sync delicata puoi controllare i conteggi:

```bash
.venv/bin/python documents/script/sync_databases.py --direction pull --dry-run
```

Di default vengono sincronizzate le collection dati e `note_attachments`; `users` resta fuori per non sovrascrivere gli account. Se serve:

```bash
.venv/bin/python documents/script/sync_databases.py --include-users
```
