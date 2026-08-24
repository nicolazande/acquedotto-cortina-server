# Manutenzione e problemi noti

## Controlli periodici

```bash
export SMOKE_TOKEN=<token admin>
npm run test:smoke          # percorso completo: API, fatturazione, allegati
npm run report:tutti  # formule, integrita, anteprime, quota fissa, storico
npm run report:integrita       # integrita referenziale e totali
```

Gli script `verify-*` sono **rapporti, non test**: stampano le anomalie trovate ed
escono sempre con codice 0. Vanno letti. Solo `test:smoke` fallisce davvero quando
qualcosa non funziona, ed e quindi l'unico adatto a una pipeline automatica.

### Un accesso al portale punta a un cliente che non esiste

`npm run report:integrita` segnala i riferimenti rotti. Sul database locale ne
risulta uno: l'utente `utente` (ruolo cliente) punta a un cliente cancellato -
quasi certamente un residuo dell'import completo, che ha rigenerato tutti gli
identificativi. L'account funziona ma non ha nulla dietro.

Si toglie dal gestionale, nella scheda del cliente, oppure si disattiva. Da oggi
non puo piu succedere: cancellare un cliente con un accesso collegato viene
rifiutato.

## Password dimenticata

Le password sono cifrate con bcrypt: non si leggono e non si recuperano, si
sostituiscono.

```bash
npm run maintenance:password                       # elenca gli utenti
npm run maintenance:password -- nicola nuovapassword
```

Vale per gli amministratori e per gli account del portale clienti. Richiede
accesso diretto al database, quindi non concede nulla in piu a chi lo esegue.

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

Il ritardo **non e un campo salvato**: cresce di un giorno al giorno per le scadenze
non pagate, quindi qualunque valore memorizzato sarebbe gia vecchio l'indomani.
Viene ricalcolato a ogni lettura (`withComputedDelay`) e, per l'ordinamento della
lista, direttamente da MongoDB (`delayAggregation`).

Il campo e stato rimosso dai record e l'import non lo riporta piu. Se ricompare,
`npm run report:integrita` lo segnala e `npm run maintenance:allinea-dati -- --fix`
lo ripulisce.

### La data di pagamento 31/12/2099

Il gestionale precedente non lasciava vuota la data di pagamento: ci scriveva
`31/12/2099` per dire "non ancora pagata". Nel nuovo modello quel significato lo
porta gia `saldo`, quindi la sentinella e stata svuotata su **740 scadenze** e
l'import non la riporta piu.

Il codice la tratta comunque come assente (`dataPagamento` in `deadlineService`),
perche un database ripristinato da un backup vecchio la conterrebbe ancora.

Restano **13 scadenze saldate senza data di pagamento**: sono pagate, ma il giorno
non e noto perche mancava all'origine. Il loro ritardo vale zero - una posizione
chiusa non accumula ritardo, e inventare una data sarebbe peggio.

### Le tariffe hanno una scadenza

Le fasce dei listini hanno una validita, ma una tariffa scaduta **non ferma la
fatturazione**: viene prorogata finche non ne arriva una nuova, perche e cosi
che funziona nella realta. Si continua quindi a fatturare ai prezzi dell'anno
prima, il che va bene per qualche settimana e non va bene per un anno intero.

Alla scrittura di questo documento le fasce di **10 listini su 15 scadono il
31/12/2026**, e riguardano 1.059 contatori su 1.061: dal 1 gennaio 2027 si
continuerebbe a fatturare ai prezzi del 2026. Un listino,
`SOCIETA' IMMOBILIARI` (2 contatori), e scaduto il 31/12/2023 ed e la causa
dell'unico errore che i rapporti segnalano da tempo.

Il gestionale lo dice in tre punti: un avviso in cima alla panoramica,
`npm run report:integrita` (che elenca anche le fasce incomplete di oggi), e il
riquadro **Prepara l'anno prossimo** nella scheda del listino, da cui si
rinnovano in un colpo con l'eventuale aumento. Vale la pena guardarlo in
autunno, non a gennaio.

### Gli incassi del 2025 non risultano registrati

Le scadenze saldate sono il 100% nel 2022, il 99% nel 2023 e nel 2024, e il **2% nel
2025**: 694 scadenze aperte per 141.212 EUR, di cui 670 con scadenza 31/12/2025.

Non e un problema di emissione: quelle fatture sono confermate, trasmesse allo SdI il
5/12/2025 e inviate ai clienti il 22/01/2026. Nel gestionale precedente l'incasso si
registrava aprendo una maschera per ogni scadenza, su una griglia senza filtri ne
ricerca; nel 2025 quel lavoro non e piu stato fatto.

Finche non sono allineati:

- il totale **da incassare** in panoramica non e attendibile;
- **la mora scatterebbe su 712 clienti su 782** alla prossima fatturazione, 4.272 EUR,
  perche viene applicata quando la scadenza precedente del cliente risulta superata;
- qualunque sollecito colpirebbe anche chi ha gia pagato.

La pagina **Incassi** serve a questo: si spuntano molte scadenze insieme confrontandole
con l'estratto conto.

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

## Capire cosa e pubblicato davvero

Client e server stanno su due servizi distinti (Netlify e Render) e si aggiornano
in momenti diversi. Quando uno resta indietro, l'interfaccia puo chiedere dati che
il server non conosce ancora.

Per sapere in pochi secondi cosa gira:

```bash
curl -s https://acquedotto-cortina-server.onrender.com/api/auth/health
```

Risponde con la versione, il commit pubblicato e da quando il processo e attivo.
La stessa informazione compare passando il puntatore sull'indicatore **API** in
alto a destra nell'interfaccia, che mostra le due versioni affiancate.

Se le due non coincidono, controllare i log di deploy del servizio rimasto
indietro: un deploy puo essere fallito senza che nulla lo segnali altrove, e il
servizio continua a servire la versione precedente.

## Sincronizzazione con il database remoto

Lo script `documents/script/sync_databases.py` copia le collection fra remoto e
locale. Prima di una sincronizzazione delicata conviene sempre un giro a vuoto:

```bash
.venv/bin/python documents/script/sync_databases.py --direction pull --dry-run
```

La collection `users` resta esclusa per non sovrascrivere gli account.
