# Riferimento API

Tutte le rotte hanno prefisso `/api`. Salvo dove indicato, richiedono
`Authorization: Bearer <token>` e ruolo `admin`.

## Convenzioni

**Liste paginate** — `GET /api/<risorsa>` accetta:

| Parametro   | Default   | Significato                                  |
|-------------|-----------|----------------------------------------------|
| `page`      | 1         | pagina richiesta                             |
| `limit`     | 50 (100 per le scadenze) | record per pagina             |
| `search`    | -         | testo cercato su tutti i campi della risorsa |
| `sortField` | vedi risorsa | campo di ordinamento                      |
| `sortOrder` | `asc`     | `asc` oppure `desc`                          |

Risposta:

```json
{ "data": [], "totalItems": 0, "totalPages": 0, "currentPage": 1 }
```

**Cancellazioni** — `DELETE /api/<risorsa>/:id` rifiuta con `409` quando il
documento e ancora collegato ad altri, e il messaggio dice a cosa ("ha ancora 12
fatture, 3 contatori"). I legami e le loro politiche sono dichiarati in
`config/relations.js`; vedi [architettura.md](architettura.md).

**Codici di stato**

| Codice | Quando                                                                 |
|--------|------------------------------------------------------------------------|
| 400    | dati della richiesta non validi                                        |
| 401    | autenticazione fallita: token assente, scaduto o non valido. La risposta contiene `reason` (`missing_token`, `token_expired`, `invalid_token`, `user_not_found`) |
| 403    | identita valida ma permessi insufficienti, oppure account disabilitato  |
| 404    | risorsa inesistente                                                    |
| 409    | conflitto: fattura confermata, lettura gia fatturata, account gia esistente, documento ancora collegato ad altri |
| 422    | il calcolo non e eseguibile in sicurezza (fasce mancanti, riparto condominiale) |
| 503    | database non raggiungibile (solo `/api/auth/health`)                   |

## Endpoint


### /api/articoli
```text
POST   /api/articoli                                        createArticolo
GET    /api/articoli                                        getArticoli
GET    /api/articoli/:id                                    getArticolo
PUT    /api/articoli/:id                                    updateArticolo
DELETE /api/articoli/:id                                    deleteArticolo
POST   /api/articoli/:articoloId/servizi/:servizioId        associateServizio
GET    /api/articoli/:id/servizi                            getServiziAssociati
```

### /api/attachments
```text
GET    /api/attachments/:id/file                            file
DELETE /api/attachments/:id                                 remove
GET    /api/attachments/:resource/:recordId                 list
POST   /api/attachments/:resource/:recordId                 create
```

### /api/auth
```text
GET    /api/auth/health                                     healthCheck
POST   /api/auth/register                                   register
POST   /api/auth/login                                      login
GET    /api/auth/profile                                    AuthMiddleware, getProfile
PUT    /api/auth/profile                                    AuthMiddleware, updateProfile
```

### /api/clienti
```text
POST   /api/clienti                                         createCliente
GET    /api/clienti                                         getClienti
GET    /api/clienti/:id/fatturazione                        getFatturazionePreview
POST   /api/clienti/:id/fatture/genera                      generateFattura
GET    /api/clienti/:id/portal-user                         getPortalUser
POST   /api/clienti/:id/portal-user                         createPortalUser
PUT    /api/clienti/:id/portal-user                         updatePortalUser
GET    /api/clienti/:id                                     getCliente
PUT    /api/clienti/:id                                     updateCliente
DELETE /api/clienti/:id                                     deleteCliente
POST   /api/clienti/:clienteId/contatori/:contatoreId       associateContatore
POST   /api/clienti/:clienteId/fatture/:fatturaId           associateFattura
GET    /api/clienti/:id/contatori                           getContatoriAssociati
GET    /api/clienti/:id/fatture                             getFattureAssociate
```

### /api/consegne
```text
GET    /api/consegne                                        getConsegne
GET    /api/consegne/riepilogo                              getRiepilogo
POST   /api/consegne/pianifica                              pianifica
POST   /api/consegne/elabora                                elabora
POST   /api/consegne/stampa                                 stampa
POST   /api/consegne/xml                                    scaricaXml
POST   /api/consegne/prova-trasporto                        provaTrasporto
POST   /api/consegne/:id/evasa                              segnaConsegnata
POST   /api/consegne/:id/coda                               rimettiInCoda
POST   /api/consegne/:id/annulla                            annulla
```

`stampa` restituisce un solo PDF con tutte le fatture da consegnare a mano, una per
pagina, e `X-Consegne-Rimaste` dice quante restano oltre il lotto. `xml` restituisce un
archivio zip con un file per fattura elettronica da trasmettere. Nessuna delle due segna
le consegne come evase: si possono ripetere.

### /api/contatori
```text
POST   /api/contatori                                       createContatore
GET    /api/contatori                                       getContatori
GET    /api/contatori/:id                                   getContatore
PUT    /api/contatori/:id                                   updateContatore
DELETE /api/contatori/:id                                   deleteContatore
POST   /api/contatori/:contatoreId/clienti/:clienteId       associateCliente
POST   /api/contatori/:contatoreId/edifici/:edificioId      associateEdificio
POST   /api/contatori/:contatoreId/listini/:listinoId       associateListino
POST   /api/contatori/:contatoreId/letture/:letturaId       associateLettura
GET    /api/contatori/:id/listino                           getListinoAssociato
GET    /api/contatori/:id/edificio                          getEdificioAssociato
GET    /api/contatori/:id/letture                           getLettureAssociate
GET    /api/contatori/:id/cliente                           getClienteAssociato
```

### /api/portale-cliente
```text
GET    /api/portale-cliente                                 getPortalData
GET    /api/portale-cliente/fatture/:id/pdf                 downloadInvoicePdf
```

### /api/edifici
```text
POST   /api/edifici                                         createEdificio
GET    /api/edifici                                         getEdifici
GET    /api/edifici/mappa                                   getMappa
GET    /api/edifici/:id                                     getEdificio
PUT    /api/edifici/:id                                     updateEdificio
DELETE /api/edifici/:id                                     deleteEdificio
POST   /api/edifici/:edificioId/contatori/:contatoreId      associateContatore
GET    /api/edifici/:edificioId/contatori                   getContatoriAssociati
```

`GET /api/edifici/mappa` non e paginato: restituisce `{ data, senzaPosizione }` con
tutti gli edifici che hanno coordinate utilizzabili, ridotti ai campi che servono a
disegnarli, piu il conteggio di quelli che ne restano fuori. La lista pagina cinquanta
record alla volta, e la mappa mostrava percio solo una parte del territorio.

### /api/fasce
```text
POST   /api/fasce                                           createFascia
GET    /api/fasce                                           getFasce
GET    /api/fasce/:id                                       getFascia
PUT    /api/fasce/:id                                       updateFascia
DELETE /api/fasce/:id                                       deleteFascia
POST   /api/fasce/:fasciaId/listini/:listinoId              associateListino
GET    /api/fasce/:id/listino                               getListinoAssociato
```

### /api/fatture
```text
POST   /api/fatture                                         createFattura
POST   /api/fatture/genera-da-letture                       generateFromReadings
GET    /api/fatture/generazione/anteprima                   getGenerationPreview
GET    /api/fatture/controlli                               getControlDashboard
GET    /api/fatture                                         getFatture
GET    /api/fatture/:id/verifica-calcolo                    verifyCalcolo
GET    /api/fatture/:id/audit                               getAuditLog
POST   /api/fatture/:id/quota-fissa                         applyFixedCharge
GET    /api/fatture/:id/pdf                                 downloadPdf
GET    /api/fatture/:id/xml                                 downloadXml
GET    /api/fatture/:id/consegne                            getAnteprima
GET    /api/fatture/:id                                     getFattura
PUT    /api/fatture/:id                                     updateFattura
DELETE /api/fatture/:id                                     deleteFattura
POST   /api/fatture/:fatturaId/cliente/:clienteId           associateCliente
POST   /api/fatture/:fatturaId/servizio/:servizioId         associateServizio
POST   /api/fatture/:fatturaId/scadenza/:scadenzaId         associateScadenza
GET    /api/fatture/:id/servizi                             getServiziAssociati
GET    /api/fatture/:id/cliente                             getClienteAssociato
GET    /api/fatture/:id/scadenza                            getScadenzaAssociata
```

### /api/province
```text
GET    /api/province                                        elenco delle province
```

Sigla e nome delle 107 province italiane, in ordine alfabetico. E l'elenco da cui
il gestionale fa scegliere, ed e lo stesso che converte la provincia in sigla per la
fattura elettronica: si puo scegliere solo una provincia che la fattura sa scrivere.

### /api/letture
```text
POST   /api/letture                                         createLettura
GET    /api/letture                                         getLetture
GET    /api/letture/:id/calcolo                             getCalcolo
GET    /api/letture/:id                                     getLettura
PUT    /api/letture/:id                                     updateLettura
DELETE /api/letture/:id                                     deleteLettura
POST   /api/letture/:letturaId/contatori/:contatoreId       associateContatore
POST   /api/letture/:letturaId/servizi/:servizioId          associateServizio
GET    /api/letture/:id/contatore                           getContatoreAssociato
GET    /api/letture/:id/servizi                             getServiziAssociati
```

Il parametro `search` sulle letture cerca anche fra i **clienti**: il testo viene
confrontato con ragione sociale, cognome e nome, e le letture dei contatori di chi
corrisponde entrano nel risultato insieme a quelle che corrispondono per campi propri.
La risposta popola `contatore.cliente`, cosi l'elenco puo mostrare di chi e la lettura.


### /api/listini
```text
POST   /api/listini                                         createListino
GET    /api/listini                                         getListini
GET    /api/listini/:id                                     getListino
PUT    /api/listini/:id                                     updateListino
DELETE /api/listini/:id                                     deleteListino
POST   /api/listini/:listinoId/fasce/:fasciaId              associateFascia
GET    /api/listini/:id/rinnovo                            getRinnovo
POST   /api/listini/:id/rinnovo                            applicaRinnovo
GET    /api/listini/:id/fasce                               getFasceAssociate
POST   /api/listini/:listinoId/contatori/:contatoreId       associateContatore
GET    /api/listini/:id/contatori                           getContatoriAssociati
```

### /api/scadenze
```text
POST   /api/scadenze                                        createScadenza
GET    /api/scadenze                                        getScadenze
GET    /api/scadenze/:id                                    getScadenza
PUT    /api/scadenze/:id                                    updateScadenza
DELETE /api/scadenze/:id                                    deleteScadenza
POST   /api/scadenze/:scadenzaId/fattura/:fatturaId         associateFattura
GET    /api/scadenze/:id/fattura                            getFatturaAssociata
```

### /api/scadenze/incassi
```text
POST   /api/scadenze/incassi                                registraIncassi
POST   /api/scadenze/incassi/annulla                        annullaIncassi
```

### /api/servizi
```text
POST   /api/servizi                                         createServizio
GET    /api/servizi                                         getServizi
GET    /api/servizi/:id                                     getServizio
PUT    /api/servizi/:id                                     updateServizio
DELETE /api/servizi/:id                                     deleteServizio
POST   /api/servizi/:servizioId/lettura/:letturaId          associateLettura
POST   /api/servizi/:servizioId/articolo/:articoloId        associateArticolo
POST   /api/servizi/:servizioId/fattura/:fatturaId          associateFattura
GET    /api/servizi/:id/lettura                             getLetturaAssociata
GET    /api/servizi/:id/fattura                             getFatturaAssociata
GET    /api/servizi/:id/articolo                            getArticoloAssociato
```

<!-- totale endpoint: 114 -->

## Note per risorsa

### `/api/auth`
`health`, `login` e `register` sono pubblici. `register` e limitato a
`MAX_ADMIN_USERS` (default 2) account amministratore; gli account del portale
clienti non consumano questo limite e si creano da `/api/clienti/:id/portal-user`.

### `/api/fatture`
- `POST /genera-da-letture` — corpo: `letture` (array di id), `data_fattura`,
  `data_scadenza`, `includeFixedCharge`, `tipo_documento`, `confermata`.
- `GET /generazione/anteprima` — `limit` (default 500, massimo 2000). Raggruppa per
  cliente le letture non ancora fatturate e ne mostra il calcolo.
- `GET /:id/verifica-calcolo` — confronta le righe salvate con il ricalcolo attuale.
- `POST /:id/quota-fissa` — aggiunge la quota fissa se applicabile.
- `DELETE /:id` — cancella la fattura **con le sue righe servizio e la scadenza**,
  e rimette le letture collegate fra quelle fatturabili. Bloccato sulle fatture confermate.

### `/api/consegne`

Le consegne dicono dove deve andare una fattura e cosa e gia partito. Una fattura
ne ha al massimo due: la **copia di cortesia** (il canale scelto sul cliente) e la
**fattura elettronica** (il canale dedotto da codice destinatario e PEC).

```text
POST /api/consegne/pianifica   { fatture: [id], anno, limite }
POST /api/consegne/elabora     { fatture: [id], tipo, limite }
```

`pianifica` mette in coda le fatture confermate che non hanno ancora una consegna
e non recapita nulla. `elabora` percorre la coda e recapita le consegne
**automatiche** (email e PEC); i canali manuali restano in elenco finche qualcuno
non li chiude con `POST /api/consegne/:id/evasa`.

Senza un server di posta configurato l'elaborazione non fallisce: registra le
consegne come **simulate**, senza spedire nulla e senza datare la fattura.
`GET /api/consegne/riepilogo` riporta lo stato del trasporto in `trasporto`.

Viste disponibili con `?vista=`: `in-coda`, `da-stampare`, `automatiche`,
`errori`, `inviate`, `elettroniche`.

### `/api/listini`

Le fasce di un listino hanno una validita: quando l'ultima utile scade, la
fatturazione di quel listino si ferma. Il rinnovo copia le tariffe in vigore
nell'anno successivo.

```text
GET  /api/listini/:id/rinnovo?anno=2027&variazione=3
POST /api/listini/:id/rinnovo   { anno, variazione }
```

L'anteprima (`GET`) non crea nulla: dice quali fasce verrebbero create, con
quale prezzo, quali sono gia valide per quell'anno, e se il risultato
resterebbe completo (`applicabile`). Il `POST` rifiuta con `422` se l'anno e
gia coperto o se il rinnovo lascerebbe buchi o sovrapposizioni.

Le fasce esistenti non vengono mai modificate: sono la tariffa con cui sono
state emesse le fatture di allora.

### `/api/scadenze`

Registrare un incasso su molte scadenze in una volta.

```text
POST /api/scadenze/incassi          { scadenze: [id], pagamento: "2026-08-24" }
POST /api/scadenze/incassi/annulla  { scadenze: [id] }
```

`incassi` tocca **solo le scadenze ancora aperte**: rieseguirlo non sovrascrive una
data di pagamento gia registrata, e riporta quante ne ha saltate in `gia_saldate`.
La data e obbligatoria e non puo essere nel futuro. Massimo 500 scadenze per
richiesta.

`incassi/annulla` riapre scadenze segnate pagate per errore e toglie la data.

`GET /api/fatture/:id` restituisce la scadenza collegata con il **ritardo gia
calcolato**: lo stato di incasso si legge dalla fattura senza rifare il conto.

Ogni scadenza toccata riceve una voce nel giornale, piu una voce per
l'operazione nel suo insieme.

### `/api/portale-cliente`
Richiede ruolo `cliente`. Restituisce solo i dati dell'anagrafica collegata
all'account; il PDF di una fattura si scarica solo se la fattura appartiene al
cliente autenticato.

### `/api/attachments`
`POST /:resource/:recordId` accetta `{ filename, contentType, data }` dove `data` e
un data URL base64. Dimensione massima per file: `ATTACHMENT_MAX_BYTES`
(default 6 MB). Tipi ammessi: immagini, PDF, TXT/CSV, Word/Excel, OpenDocument.
