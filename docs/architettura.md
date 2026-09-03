# Architettura del server

Express 4 + Mongoose 8. Nessun framework applicativo sopra: la struttura si regge
su tre livelli e su un insieme di funzioni condivise.

```
richiesta HTTP
    │
    ├─ server.js            CORS, body parser, montaggio /api, gestione errori
    ├─ routes/              quali URL esistono
    ├─ middlewares/         chi sei (AuthMiddleware) e cosa puoi fare (AuthorizationMiddleware)
    ├─ controllers/         traduzione HTTP <-> dominio, nessuna regola di calcolo
    ├─ services/            le regole: fatturazione, PDF, scadenze, audit
    ├─ models/              schemi Mongoose e indici
    └─ utils/               funzioni pure condivise da tutti i livelli
```

Le collezioni e i loro legami sono disegnati in [modello.md](modello.md), generato
dagli schemi con `npm run modello`: un test fallisce se il disegno resta indietro
rispetto al codice.

## Il percorso di una richiesta

1. `server.js` applica CORS e i parser del corpo.
2. `routes/index.js` monta le rotte. L'ordine conta:
   - `/api/auth` e pubblico (login, registrazione, health);
   - `/api/portale-cliente` richiede autenticazione **e** ruolo `cliente`;
   - tutto il resto richiede autenticazione **e** ruolo `admin`.
3. Il controller valida il minimo indispensabile e delega al servizio.
4. Gli errori applicativi portano con se uno `status` (`utils/errors.js`) che il
   controller usa nella risposta; quelli non gestiti finiscono nell'error handler
   centrale, che non espone mai lo stack al client.

## I moduli

### `utils/` — funzioni condivise

| File          | Contenuto                                                        |
|---------------|------------------------------------------------------------------|
| `values.js`   | numeri e denaro (`numberOrZero`, `roundMoney`, `sumMoneyBy`), booleani da querystring, normalizzazione testo, escape regex |
| `dates.js`    | conversioni data, `startOfDay` in UTC, differenze in giorni, data all'italiana |
| `errors.js`   | errori con status HTTP (`notFound`, `conflict`, `unprocessable`, ...) |
| `mongo.js`    | `withSession`, `recordId`, `toObjectId`, `uniqueById`             |
| `customer.js` | etichetta del cliente (ragione sociale oppure cognome + nome)     |
| `money.js`    | aritmetica monetaria in centesimi interi: conversioni, somme esatte, aliquote in punti base |

Queste funzioni erano duplicate in cinque servizi diversi. Se serve una variante,
va aggiunta qui, non ricopiata.

### `services/` — le regole

| File                        | Responsabilita                                                    |
|-----------------------------|-------------------------------------------------------------------|
| `billingCalculator.js`      | **puro, senza database**: da lettura + fasce + articoli produce righe e totali |
| `invoiceGenerator.js`       | orchestrazione: carica i dati, blocca le letture, numera, salva, anteprime |
| `invoiceDeletionService.js` | cancellazione completa di una fattura (righe, scadenza, sblocco letture) |
| `invoiceLockService.js`     | regola unica sulle fatture confermate                             |
| `annualFixedChargeService.js` | quota fissa gia applicata nell'anno per contatore                |
| `deadlineService.js`        | scadenze, calcolo del ritardo in JavaScript e in aggregazione MongoDB |
| `invoiceControlService.js`  | cruscotto anomalie su piu fatture                                 |
| `invoicePdf.js`             | generatore PDF scritto a mano, senza dipendenze esterne           |
| `invoiceXml.js`             | fattura elettronica nel tracciato FatturaPA 1.2                   |
| `deliveryPlan.js`           | **puro, senza database**: dove deve andare una fattura e cosa lo blocca |
| `deliveryService.js`        | la coda delle consegne: pianifica, elabora, registra l'esito      |
| `tariffService.js`          | scadenza e rinnovo delle tariffe, copertura delle fasce           |
| `paymentService.js`         | registrazione degli incassi su piu scadenze insieme               |
| `referentialIntegrity.js`   | applica i legami dichiarati in `config/relations.js` |
| `mailer.js`                 | l'unico punto in cui un messaggio esce davvero                    |
| `dashboardService.js`       | i numeri della panoramica                                         |
| `invoiceAuditService.js` / `auditLogService.js` | tracciamento delle modifiche      |
| `transaction.js`            | transazione quando il database la supporta, fallback quando no    |
| `righeFattura.js`           | come si leggono le righe di una fattura: due forme, non sette copie |
| `counters.js`               | i progressivi persistenti: numero della fattura e progressivo di invio |
| `counterHistoryService.js`  | la storia di un punto di fornitura attraverso le sostituzioni     |

`billingCalculator.js` e `deliveryPlan.js` non conoscono Mongoose: si testano
passando oggetti semplici. Tutto cio che tocca il database sta rispettivamente in
`invoiceGenerator.js` e `deliveryService.js`.

**Una regola, un posto.** Le poche che decidono soldi o identita vivono ognuna in
un file solo, e chi ne ha bisogno la importa invece di riscriverla:

| Regola                                   | Dove vive                    |
|------------------------------------------|------------------------------|
| aritmetica monetaria, IVA per aliquota    | `utils/money.js`             |
| confini di una fascia tariffaria          | `billingCalculator.js`       |
| aliquota di una riga, dal suo articolo    | `billingCalculator.js`       |
| totali di una fattura e importo scadenza  | `invoiceGenerator.js`        |
| chi dipende da chi alla cancellazione     | `config/relations.js`        |
| dove va a finire una fattura              | `config/delivery.js`         |
| province e loro sigla                     | `utils/province.js`          |

Sono state tutte, in origine, scritte due volte. Ogni volta la copia in piu ha
prodotto un difetto silenzioso: il riquadro IVA del PDF che dichiarava il 15%
sulla mora esente, i totali che restavano fermi aggiungendo una riga, la
scadenza che non seguiva la fattura. Prima di duplicarne una, conviene ricordare
che il costo non e la riga in piu: e il giorno in cui le due copie diranno cose
diverse e nessuno se ne accorgera.

> **Il modulo da tenere d'occhio.** `invoiceGenerator.js` e a 1.080 righe e cinque
> responsabilita (calcolo di una lettura, anteprime, creazione, verifica, quota
> fissa): e li che atterra ogni nuova funzione sulle fatture. Non e ancora un
> problema, ma e il posto dove lo diventera per primo.

### `controllers/utils/` — i CRUD non si scrivono a mano

| File                   | Cosa fornisce                                                       |
|------------------------|---------------------------------------------------------------------|
| `controllerActions.js` | fabbriche `createRecord`, `getRecord`, `updateRecord`, `deleteRecord`, `associateRecords`, `getManyByField`, `getPopulatedRelation` |
| `paginatedQuery.js`    | `sendPaginated`: paginazione, ricerca e ordinamento condivisi        |
| `requestOptions.js`    | lettura dei booleani da querystring                                 |

Un controller tipico e quindi solo una mappa di risorse e relazioni
(vedi `ContatoreController.js`): la logica sta nelle fabbriche.

`sendPaginated` costruisce la ricerca introspezionando lo schema Mongoose: cerca
con espressione regolare sui campi stringa, per valore esatto sui numerici e sulle
date. Accetta anche `addFields`, che fa passare la query da una aggregazione per
ordinare su valori calcolati (usato dalle scadenze per il ritardo).

### `models/` — schemi e indici

Gli indici sono dichiarati nello schema e creati all'avvio. Quelli che contano:

- `Lettura`: `{ contatore, data_lettura }` per la ricerca della lettura precedente,
  `{ fatturata, data_lettura }` per le anteprime;
- `Servizio`: `{ fattura, riga }` e `{ lettura, fattura }`;
- `Fattura`: `{ anno, numero }`, `{ cliente, data_fattura }`, `{ scadenza }`;
- `Contatore`: `cliente`, `edificio`, `listino`;
- `Consegna`: `{ fattura, tipo }` unico, perche una fattura ha al massimo una
  consegna per tipo, e `{ stato, automatica }` per la coda.

## I legami fra documenti

MongoDB non ha vincoli di integrita referenziale: cancellando un cliente, le sue
fatture resterebbero a puntare a un documento inesistente e nessuno lo
segnalerebbe. Il controllo lo fa l'applicazione, e la mappa dei legami sta in un
posto solo, `config/relations.js`.

Due politiche, con il vocabolario che usano tutti (Prisma, Doctrine, SQL):

| Politica  | Significato | Dove |
|-----------|-------------|------|
| `blocca`  | la cancellazione e rifiutata con un 409 che dice cosa e collegato | anagrafiche: cliente con fatture, contatore con letture, articolo usato nelle righe |
| `cascata` | i collegati se ne vanno insieme al padre | righe e consegne di una fattura, fasce di un listino |

Il caso normale e **bloccare**. In un archivio contabile una cancellazione che
si propaga in silenzio e peggio di un messaggio che dice "questo cliente ha 12
fatture": il secondo si legge e si decide, la prima si scopre mesi dopo. E anche
cio che fa il gestionale precedente, che su clienti, listini, articoli ed edifici
non offre proprio il pulsante di eliminazione.

Il controllo e dentro `deleteRecord`, la fabbrica da cui passano tutte le
cancellazioni: nessun controller deve ricordarsene. Fa eccezione la fattura, che
ha una cascata piu ampia (sblocca anche le letture) e vive in
`invoiceDeletionService`.

La stessa dichiarazione serve al rapporto di integrita, che percorre i legami
uno per uno invece di riscriverli: aggiungere un riferimento a uno schema senza
dichiararlo fa fallire un test.

## Test

I test unitari stanno in `tests/` e usano il runner integrato di Node
(`node --test`), senza dipendenze aggiuntive. Coprono il calcolatore di
fatturazione, l'aritmetica in centesimi, le scadenze, le regole di consegna e le
funzioni condivise.

`scripts/smoke-api.js` e invece un test end-to-end contro un server avviato:
crea i propri dati, verifica il percorso completo e ripulisce tutto. Funziona
sia sul database reale sia su uno vuoto, quindi gira anche in CI.

## Autenticazione e ruoli

Il token JWT contiene `userId` e `role`, dura `JWT_EXPIRES_IN` (default 8 ore).
`AuthMiddleware` risponde **401** a ogni esito negativo (token assente, scaduto,
non valido, utente inesistente) e aggiunge un campo `reason` che il client usa per
spiegare all'utente perche e stato disconnesso. Il 403 resta riservato ai casi in
cui l'identita e valida ma i permessi no (ruolo sbagliato, account disabilitato).

Tre ruoli: `admin` vede tutto il gestionale, `cliente` solo il proprio portale,
`letturista` le quattro risorse che gli servono per il giro delle letture.

Il permesso si decide in `routes/index.js`, e **l'ordine e la protezione**:

```
router.use(AuthMiddleware);                                   da qui serve l'accesso

router.use('/edifici',   anchePerLetturista('edifici'),   ...)
router.use('/contatori', anchePerLetturista('contatori'), ...)
router.use('/clienti',   anchePerLetturista('clienti'),   ...)
router.use('/letture',   anchePerLetturista('letture'),   ...)

router.use(requireAdmin);                                     sotto questa riga, tutto chiuso
router.use('/fatture',   ...)                                 e chi aggiunge una rotta
router.use('/consegne',  ...)                                 la trova gia protetta
```

Il montaggio dice **quale** risorsa; cosa se ne puo fare lo dice
`RISORSE_DEL_LETTURISTA` in `middlewares/AuthorizationMiddleware.js`, in un posto
solo:

| risorsa | scrittura | relazioni raggiungibili |
|---|---|---|
| `edifici` | no | `contatori` |
| `contatori` | no | `cliente`, `edificio`, `letture`, `storia` |
| `clienti` | no | `contatori` |
| `letture` | **si** | `contatore` |

Le relazioni contano quanto la risorsa. Sotto `/clienti` vivono anche
`/:id/fatture`, `/:id/fatturazione` e `/:id/portal-user`; sotto `/letture`,
`/:id/servizi` e `/:id/calcolo`. Aprire la risorsa senza dire quali sotto-rotte
apre dava al letturista fatture, importi e credenziali del portale: nascosti nel
menu, ma raggiungibili scrivendo l'indirizzo. Ora tutto cio che non e dichiarato
e chiuso, quindi anche una sotto-rotta aggiunta domani nasce chiusa, come le
risorse nuove sotto `requireAdmin`. Montare una risorsa non prevista solleva un
errore all'avvio: meglio un server che non parte di uno che apre le fatture per
un refuso.

Non c'e un sistema di permessi generale: con tre ruoli e quattro risorse aperte
costerebbe piu di quanto renda, e sarebbe generalizzazione prematura. Se un
giorno i ruoli saranno sei, quello sara il momento di estrarlo.

Il profilo (`GET /api/auth/profile`) restituisce anche `risorse` (cosa quel ruolo
puo aprire) e `scrivibili` (cosa puo anche cambiare). Il client ci disegna
**menu, rotte, riquadri delle relazioni e pulsanti**: l'elenco e uno solo,
deciso dal server che concede i permessi, e il client non tiene una propria idea
di chi vede cosa che col tempo direbbe altro.

`risorse` comprende anche due aree che non sono risorse con elenco e scheda -
`panoramica` e `consegne`, che non hanno un modello - e `portale-cliente` per il
ruolo `cliente`. Sono pagine che si aprono, quindi stanno nello stesso elenco:
quando non c'erano, il menu dell'amministratore perdeva Panoramica, Consegne e
Incassi, perche il client filtrava confrontando l'indirizzo con i nomi delle
risorse e quelli non erano fra loro.

Nel client ogni voce di navigazione dichiara la propria `area`, e
`areaDelPercorso` traduce un indirizzo nel nome corrispondente guardando il
primo segmento: cosi `/fatture/generazione` e `/fatture/12/cliente` ricadono
sotto `fatture` senza doverli elencare. Una voce senza area - il profilo - la
apre chiunque sia entrato. Da quella stessa dichiarazione si costruiscono le
rotte: **una pagina che il ruolo non puo aprire non viene montata**, e chi ne
scrive l'indirizzo finisce sulla propria pagina iniziale invece di vedere una
schermata che si riempie di errori. Prima esistevano due elenchi paralleli di
rotte e di voci, uno per il cliente e uno per tutti gli altri: aggiungere una
pagina voleva dire ricordarsi di entrambi.

Un riquadro verso una risorsa non concessa - Fatture sulla scheda cliente,
Listino su quella di un contatore - non compare, e su cio che si puo solo
consultare spariscono "Nuovo", "Modifica", "Elimina" e "Associa": un pulsante che
risponde 403 e peggio di un pulsante assente.

Restano fuori da questo conto i pannelli che non appartengono a nessuna risorsa -
accesso al portale di un cliente, anteprima di fatturazione, calcolo di una
lettura. Sono lavoro d'ufficio e si dichiarano tali (`soloAmministratore`), cosi
non vengono disegnati su schede che il letturista apre legittimamente.

Gli allegati hanno una rotta sola per tutte le risorse
(`/attachments/:resource/:id`), quindi il permesso non puo stare sul montaggio:
lo decide il controller guardando **a cosa e attaccata** la nota, con la stessa
funzione (`puoUsareRisorsa`) che protegge le rotte - prima erano due copie della
stessa regola. Un allegato vale
quanto il documento che lo porta, e le risorse aperte sono quelle di
`RISORSE_DEL_LETTURISTA`. Un test verifica che quell'elenco e le rotte montate
dicano la stessa cosa, perche sono due espressioni dello stesso fatto.

Il letturista vede di un cliente solo i campi di `CAMPI_PER_LETTURISTA`
(`utils/customer.js`): nome, recapito, telefono. Codice fiscale, partita IVA,
IBAN e mandato non gli vengono inviati - il taglio e sul server, nelle due sole
vie da cui un cliente esce intero, perche nasconderli nel client sarebbe un
trucco visivo e non una protezione.

## Allegati

Gli allegati delle note sono salvati in MongoDB (`note_attachments`), non sul
filesystem: il server puo quindi girare su piattaforme con disco effimero.
Il tipo del file viene verificato contro una lista chiusa; HTML ed eseguibili
sono rifiutati.
