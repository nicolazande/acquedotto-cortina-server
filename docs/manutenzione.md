# Manutenzione e problemi noti

## Controlli periodici

```bash
export SMOKE_TOKEN=<token admin>
npm run test:smoke          # percorso completo: API, fatturazione, allegati
npm run test:billing-audit  # formule, integrita, anteprime, quota fissa, storico
npm run test:invoices       # integrita referenziale e totali
```

Gli script `verify-*` sono **rapporti, non test**: stampano le anomalie trovate ed
escono sempre con codice 0. Vanno letti. Solo `test:smoke` fallisce davvero quando
qualcosa non funziona, ed e quindi l'unico adatto a una pipeline automatica.

## Backup

Prima di qualunque operazione che modifica i dati:

```bash
docker exec acquedotto-cortina-mongo mongodump --db=acquedotto-zuel \
  --archive=/tmp/backup.archive
docker cp acquedotto-cortina-mongo:/tmp/backup.archive ./backups/backup-$(date +%Y%m%d-%H%M%S).archive
```

Ripristino:

```bash
docker cp ./backups/<file>.archive acquedotto-cortina-mongo:/tmp/r.archive
docker exec acquedotto-cortina-mongo mongorestore --drop --archive=/tmp/r.archive
```

In `backups/` sono conservate le copie create prima delle operazioni gia eseguite,
ognuna con un `manifest.json` che spiega cosa e stato cambiato e come tornare indietro.

## Cose da sapere sui dati

### Il ritardo delle scadenze e un valore derivato

`Scadenza.ritardo` esiste come campo salvato, ma **non va letto**: viene ricalcolato
a ogni lettura (`withComputedDelay`) perche cresce di un giorno al giorno per le
scadenze non pagate. Anche l'ordinamento della lista lo ricalcola in MongoDB
(`delayAggregation`). Il valore salvato resta disallineato ed e normale: al momento
della scrittura di questo documento 2.344 scadenze su 2.701 hanno un valore
memorizzato diverso da quello reale, senza alcun effetto su cio che viene mostrato.

### Il campo `saldo` non e sempre un booleano

Alcuni record importati hanno `saldo: 1` invece di `saldo: true`. Mongoose converte
in lettura, ma le aggregazioni no: nelle pipeline usare `$toBool` e non `$eq: true`.

### `Lettura.consumo` e l'indice del contatore

Non e il consumo del periodo ma la lettura progressiva. Vedi
[fatturazione.md](fatturazione.md).

### Letture bloccate

Una lettura con `fatturata: true` non entra piu nelle anteprime di fatturazione.
Il blocco viene rimosso automaticamente quando si cancella la fattura collegata.
Per trovare eventuali letture bloccate senza una fattura che le giustifichi:

```javascript
// mongosh acquedotto-zuel
const conServizio = new Set(db.servizi.find({lettura:{$ne:null}}, {lettura:1})
  .toArray().map(s => String(s.lettura)));
db.letture.find({fatturata:true}).toArray()
  .filter(l => !conServizio.has(String(l._id)))
  .length
```

## Problemi noti e limiti

| Argomento | Situazione |
|-----------|------------|
| Arrotondamento IVA | L'IVA e sommata riga per riga e arrotondata alla fine, non raggruppata per aliquota come nella fatturazione elettronica. Puo differire di 1 centesimo. Scelta consapevole, vedi [fatturazione.md](fatturazione.md). |
| Importi in centesimi | Tutta l'aritmetica monetaria e in centesimi interi con arrotondamento commerciale. Ricalcolando lo storico, 48 fatture su 3.469 risultano diverse di 1 centesimo dal gestionale precedente: rientra nella tolleranza dei controlli. |
| Sessione | Il token dura `JWT_EXPIRES_IN` (default 8 ore) e non esiste un meccanismo di rinnovo: alla scadenza serve un nuovo login. |
| Cancellazioni | Cancellare una fattura ripulisce righe, scadenza e blocchi delle letture. Cancellare un **cliente** o un **contatore** non ripulisce nulla: i record collegati restano con un riferimento a un documento inesistente. |
| Registrazione | Limitata a `MAX_ADMIN_USERS` amministratori (default 2). Gli account del portale clienti si creano dalla scheda cliente. Non e imposto un requisito di robustezza sulla password degli amministratori. |
| Elenchi | Una richiesta restituisce al massimo `MAX_PAGE_SIZE` record (default 500). Serve a evitare che una singola chiamata scarichi l'intero archivio. |
| Accessi | Dopo `LOGIN_MAX_ATTEMPTS` tentativi falliti (default 10) lo stesso indirizzo e nome utente riceve `429` per `LOGIN_WINDOW_MS`. Il conteggio sta in memoria: con piu istanze andrebbe spostato su un archivio condiviso. |
| Tracciamento | Sono registrate le modifiche a fatture, righe servizio, listini, fasce e articoli. Restano fuori clienti, contatori, edifici e letture. |
| react-scripts 3 | Il client dipende da una versione del 2019 che richiede `--openssl-legacy-provider`. Funziona, ma e il debito tecnico piu rilevante del progetto. |

## Deploy

### Server (Render)

La versione di Node e fissata in `package.json` (`engines`), in `.node-version`
e nella CI: **Node 24 "Krypton"**, in supporto a lungo termine fino al
30 aprile 2028. Node 20 e uscito dal supporto il 30 aprile 2026 e non riceve
piu correzioni di sicurezza, quindi non va piu usato.
Non ci sono dipendenze di runtime nuove: `eslint` sta fra le devDependencies e
non viene installato quando `NODE_ENV=production`.

Variabili facoltative introdotte di recente:

| Variabile | Default | Effetto |
|-----------|---------|---------|
| `JWT_EXPIRES_IN` | `8h` | durata della sessione |
| `MAX_ADMIN_USERS` | `2` | quanti amministratori possono registrarsi liberamente |

Al primo avvio dopo l'aggiornamento Mongoose crea gli indici mancanti sulle
collection: su questi volumi e questione di millisecondi, ma succede all'avvio.

Su un database nuovo va eseguito una volta `npm run seed:articoli`, altrimenti
la fatturazione si ferma per mancanza degli articoli obbligatori.

### Client (Netlify)

`netlify.toml` fissa comando di build (`npm run build`), cartella pubblicata
(`build`) e versione di Node. Quest'ultima e importante: Vite 6 supporta Node
18, 20 e 22 ma **non** 19 e 21, quindi lasciare il valore predefinito della
piattaforma esporrebbe la build a rompersi da sola.

La variabile `REACT_APP_API_URL` continua a funzionare: la configurazione
accetta sia il prefisso `REACT_APP_` sia `VITE_`.

### Quando aggiornare Node

Node esce dal supporto ad aprile dell'anno pari successivo alla sua uscita:

| Versione | Fine supporto |
|----------|---------------|
| 20 | 30 aprile 2026 (gia scaduta) |
| 22 | 30 aprile 2027 |
| **24 (in uso)** | **30 aprile 2028** |
| 26 | 30 aprile 2029 |

Il momento naturale per il salto successivo e l'autunno 2027, quando la 26 sara
in supporto da un anno. L'aggiornamento consiste nel cambiare `engines`,
`.node-version`, `NODE_VERSION` in `netlify.toml` e `node-version` nelle CI, piu
il Node in `.tools/` usato dagli script locali.

Nota su npm 11 (incluso da Node 24): gli script di installazione dei pacchetti
sono bloccati per impostazione predefinita. Nel progetto non e un problema,
perche `bcrypt` e `esbuild` distribuiscono binari gia compilati, ma se in futuro
entrasse una dipendenza che deve compilarsi in fase di installazione andra
autorizzata esplicitamente.

## Sincronizzazione con il database remoto

Lo script `documents/script/sync_databases.py` copia le collection fra remoto e
locale. Prima di una sincronizzazione delicata conviene sempre un giro a vuoto:

```bash
.venv/bin/python documents/script/sync_databases.py --direction pull --dry-run
```

La collection `users` resta esclusa per non sovrascrivere gli account.
