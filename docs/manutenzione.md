# Manutenzione e problemi noti

## Controlli periodici

```bash
export SMOKE_TOKEN=<token admin>
npm run test:smoke          # percorso completo: API, fatturazione, allegati
npm run report:tutti  # formule, integrita, anteprime, quota fissa, storico
npm run report:integrita       # integrita referenziale e totali
npm run modello             # ridisegna docs/modello.md dagli schemi
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

## Account e ruoli

I ruoli sono tre: `admin` vede tutto, `letturista` le quattro risorse del giro
letture (edifici, contatori, clienti in sola lettura, letture anche in scrittura),
`cliente` solo il proprio portale.

La registrazione dal gestionale crea sempre un amministratore e nessuna schermata
permette di scegliere il ruolo: un letturista si crea da riga di comando.

```bash
npm run maintenance:password -- mario passwordsegreta letturista
```

Indicando il ruolo l'account viene creato se non esiste, o cambia ruolo se c'e
gia. Senza ruolo il comando reimposta soltanto la password.

### Lavorare sul database di produzione

Tutti gli script di manutenzione accettano `--remoto`: prendono l'indirizzo da
`REMOTE_MONGODB_URI` nel `.env`, annunciano che stanno lavorando sulla produzione
e scrivono il nome del database prima di toccare qualsiasi cosa.

```bash
npm run maintenance:password -- brunodonaz Piandl64 letturista --remoto
npm run maintenance:password -- --remoto      # elenca gli utenti di produzione
```

Serve un'opzione apposta perche l'alternativa - passare l'indirizzo a mano sulla
riga di comando - e il modo piu facile di lavorare sul database sbagliato: basta
che la variabile non sia esportata nella shell e il comando punta altrove senza
dirlo.

> **Prima di creare un account in produzione**, se non e mai stato fatto:
>
> ```bash
> npm run maintenance:user-indexes -- --remoto
> ```
>
> Gli indici unici su `email` e `numero_telefono` sono nati prima che lo schema
> li dichiarasse *sparsi*. Con la vecchia forma, il secondo account senza email
> viene rifiutato con `E11000 duplicate key ... { email: null }`: due account che
> non hanno l'indirizzo risultano due volte lo stesso valore. Il comando li
> ricrea nella forma giusta, dove chi non ha il campo semplicemente non entra
> nell'indice. E successo davvero, creando il primo letturista.

## Password dimenticata

Le password sono cifrate con bcrypt: non si leggono e non si recuperano, si
sostituiscono.

```bash
npm run maintenance:password                       # elenca gli utenti
npm run maintenance:password -- nicola nuovapassword
npm run maintenance:password -- mario passwordsegreta letturista   # crea l'account
```

Vale per gli amministratori e per gli account del portale clienti. Richiede
accesso diretto al database, quindi non concede nulla in piu a chi lo esegue.

## Dove finiscono i file allegati

Di suo il gestionale tiene i byte dentro MongoDB, nel documento dell'allegato:
non c'e niente da configurare e un backup del database porta con se anche i file.
Va bene finche i file sono pochi.

Con una foto per lettura si arriva a circa **300 MB il primo anno** e **2,7 GB in
dieci** (900 letture l'anno, foto ridotte dal client a ~300 KB). Su un database
quello spazio costa caro e appesantisce ogni copia: il ripristino passa da
secondi a minuti, e ogni backup si porta dietro tutte le fotografie.

Percio i byte possono andare in un archivio a oggetti - **Cloudflare R2** ha 10 GB
gratuiti permanenti e non fa pagare il traffico in uscita, che e la voce che
altrove cresce senza farsi notare. Va bene qualunque servizio che parli il
protocollo S3.

Si accende mettendo quattro variabili nell'ambiente del server:

```
R2_ACCOUNT_ID=...
R2_BUCKET=allegati
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

Senza di esse **non cambia niente**: si continua a salvare nel database come
prima. Metterne solo alcune invece ferma il server all'avvio, perche una
configurazione a meta si scoprirebbe al primo allegato caricato.

Due cose da sapere:

- **I vecchi allegati restano dove sono.** Non serve nessuna migrazione: chi ha i
  byte nel documento continua a leggersi da li, i nuovi vanno nell'archivio.
  Convivono senza che l'utente noti la differenza.
- **I file restano privati.** Li serve sempre il gestionale, che prima controlla
  chi sta chiedendo - il letturista vede gli allegati di un contatore, non quelli
  di una fattura. Nel secchio non va aperto nessun accesso pubblico.

Conviene attivare il *versioning* sul bucket: l'archivio custodisce i file, ma
non protegge da una cancellazione sbagliata piu di quanto facesse il database.

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

### L'import da Gesco leggeva male alcuni dati

Fino al 17/09/2026 l'import (`documents/script/main.py`) aveva questi difetti,
tutti corretti. I numeri di Zuel sono quelli della copia locale.

- **scadenze lette solo in parte**: oltre l'ultima pagina Gesco ripete l'ultima, e
  il ciclo non se ne accorgeva: arrivava sempre a 27 pagine. Dove le pagine erano
  meno, l'ultima finiva nel database piu volte (Campo: 845 copie); dove erano di
  piu, il resto non veniva letto (Zuel: nessuna scadenza del 2021 e parte del
  2022, cioe le 770 fatture senza scadenza);
- **letture vecchie perse**: la scheda del contatore ne mostra cinque per pagina e
  si leggeva solo la prima (Campo 320 contatori, Zuel 703). La fatturazione non ne
  risente, perche usa l'ultima lettura;
- **numero della fattura**: nella pagina della fattura "Numero" compare tre volte,
  prima come numero del documento e poi come civico dei due indirizzi, e si teneva
  l'ultimo. Il `numero` delle fatture importate prima della correzione **e il
  civico**, non il numero: a Zuel 2.777 fatture su 3.472 hanno il civico del
  cliente, 464 sono vuote (civico non numerico, "12/A") e la coppia (anno, numero)
  si ripete su 498 gruppi. Il numero vero si legge in Gesco, colonna "N." sia
  nell'elenco delle fatture sia in quello delle scadenze;
- **cliente della fattura**: si cercava per nome e cognome e fra omonimi vinceva il
  primo trovato. A Zuel 10 fatture sono intestate al cliente sbagliato (Pompanin
  Claudio: due persone diverse; Menardi Massimo: la stessa persona con due schede)
  e 121 sono rimaste senza cliente. Ora si usa il "Codice" della fattura, che e
  l'id del cliente in Gesco e sta sul cliente nel campo `codice`;
- **scadenza della fattura**: si cercava per anno, totale e intestatario, cosi due
  fatture di pari importo nello stesso anno finivano sulla stessa scadenza e le
  altre restavano orfane (Zuel: 8 fatture su 3 scadenze, 3 scadenze orfane; Campo
  6 e 15). Ora si usano anno e numero, che in Gesco individuano il documento;
- **edificio del contatore**: si collegava il primo contatore con la matricola
  della riga. Dove due contatori hanno la stessa matricola - un subentro, o una
  matricola segnaposto come "00000" - uno finiva nell'edificio dell'altro (Zuel 3
  casi, Campo 1). Ora conta anche il cliente scritto nella riga.

I dati di Zuel in produzione vengono dall'import vecchio: vanno corretti con un
recupero mirato, senza reimportare, perche in produzione si lavora da settimane.
Serve Gesco, quindi va fatto finche e raggiungibile.

Le fatture che l'import lascia senza cliente si collegano con
`npm run maintenance:allinea-dati -- --fix`, quando la ragione sociale e di un
solo cliente.

### Il recupero dei dati di Zuel, fatto il 21/09/2026

I dati di produzione venivano dall'import vecchio, che sbagliava piu cose. Sono
stati recuperati leggendo di nuovo tutto da Gesco in un database a parte e
portando **solo le differenze** in produzione: le fatture emesse da qui, le
consegne, gli account e le tariffe rinnovate nel gestionale non sono state
toccate.

```bash
# 1. la copia fresca, in un database suo
MONGODB_URI=mongodb://localhost:27017/acquedotto-zuel-gesco MONGODB_DB=acquedotto-zuel-gesco \
  IMPORT_RESET_DB=1 npm run gesco:import

# 2. l'audit: dove i due database non coincidono, e perche
npm run gesco:confronta -- --origine acquedotto-zuel-gesco --remoto

# 3. le differenze, prima mostrate e poi applicate
npm run gesco:allinea -- --origine acquedotto-zuel-gesco --remoto
npm run gesco:allinea -- --origine acquedotto-zuel-gesco --scrivi --remoto
npm run maintenance:allinea-dati -- --fix --remoto   # normalizza cio che e appena entrato
```

Cosa e stato corretto in produzione: **3.467 numeri di fattura** (erano il civico
dell'indirizzo), **683 scadenze** mai importate e il loro legame con la fattura,
**646 letture** vecchie, 18 letture con lo stato di fatturazione sbagliato, 4
fatture che puntavano alla scadenza di un'altra, 2 fatture emesse in Gesco dopo
l'ultimo import, un cliente con il suo contatore (ALVERA MICHELA, mai importata)
e una data di cessazione arrivata dopo l'import.

Dopo: 0 riferimenti rotti, 0 fatture senza cliente, 0 totali che non tornano. Le
89 fatture senza scadenza e la scadenza orfana rimasta sono cosi anche in Gesco.

Restano due contatori da assegnare a mano a un edificio (CASA B, CAPANNONE
F.LLI PIZZOLOTTO) e 126 matricole condivise da confermare come subentri.

### Le spunte non sono mai state importate

Una casella di spunta in Gesco non ha testo: l'import leggeva il testo della
cella, trovava vuoto e scartava il campo, e `parse_bool(None)` lo dava per "no".
**Tutte** le spunte importate risultano quindi false su ogni record, anche dove
in Gesco sono spuntate: `socio` e `fattura_elettronica` sui clienti, `inattivo`,
`subentro`, `sostituzione` e `condominiale` sui contatori.

Si vede dai dati di Zuel: 3.452 fatture su 3.472 hanno una data di fattura
elettronica - sono passate dallo SdI, per 780 clienti diversi - eppure nessun
cliente risulta impostato per la fattura elettronica. Nessun socio su 900, e
nessun contatore inattivo su 1.061.

Conseguenza pratica: la coda delle consegne non prepara nessuna fattura
elettronica, perche le prepara solo per i clienti con quella spunta.

L'import corretto le legge (`valore_della_cella`). Per i dati gia importati:

```bash
npm run gesco:login            # il CAPTCHA si risolve a mano
npm run gesco:spunte           # mostra cosa cambierebbe
npm run gesco:spunte -- --scrivi [--remoto]
```

Rilegge le schede di Gesco in sola lettura e aggiorna solo quei campi, piu il
`codice` Gesco del cliente dove manca. Su Campo, il 21/09/2026: 368 clienti su
374 in fattura elettronica, 31 soci, 16 contatori inattivi, 67 subentri, 15
sostituzioni, 11 condominiali - tutti valori che prima erano zero.

### Una fattura confermata dalla maschera restava una bozza

Fino al 21/09/2026 confermare una fattura dalla sua scheda la lasciava con
`confermata: true` e `stato: 'bozza'`. Contano entrambi, ma chi cerca guarda lo
**stato**: l'elenco *Confermate* e la coda delle consegne, che prepara solo
fatture confermate. Quella fattura spariva da tutti e due, e sembrava che
confermarla non avesse fatto niente.

Due cause, corrette insieme:

- con i timestamp attivi Mongoose riscrive l'aggiornamento in forma mista - i
  campi passati in cima, un `$set` con `updatedAt` accanto - e il gancio del
  modello guardava solo dentro `$set`: la spunta non la vedeva
  (`allineaStatoNellAggiornamento` in `models/Fattura.js`);
- la maschera rispedisce l'intero record, quindi insieme alla spunta arrivava
  lo stato di prima, e il controller teneva quello. Ora, se la richiesta porta
  `confermata`, e quella a decidere.

**Sui documenti gia salvati cosi** il rimedio e
`npm run maintenance:allinea-dati -- --fix`, che porta lo stato al valore della
spunta. Da eseguire in produzione dopo aver pubblicato la correzione.

### La coda delle consegne prima del 22/09/2026

Tre difetti, corretti insieme (le regole di oggi sono in
[Come esce una fattura](consegne.md)):

- *Prepara* guardava le **500 fatture piu recenti**, storico compreso. Una
  fatturazione di Zuel ne fa circa 670 con la stessa data: circa 170 restavano
  senza consegna anche ripremendo, e le consegne aperte fuori da quella finestra
  non si chiudevano (a Zuel 3 copie gia spedite restavano fra quelle da stampare);
- guardando lo storico, proponeva consegne che il vecchio programma aveva lasciato
  apposta: le 7 fatture elettroniche di dicembre 2025 di clienti che ogni anno
  partono per altra via, e 13 copie cartacee delle fatture singole del 2026, gia
  trasmesse come elettroniche;
- una **prova di invio**, senza posta attiva, chiudeva la consegna come inviata
  (`simulata: true`): a posta attiva il cliente non avrebbe ricevuto niente.

Scoperto per strada: con Mongoose 8 un campo messo a `undefined` in un `$set`
viene ignorato, non cancellato. Il vecchio problema restava sulla riga anche
dopo la correzione in anagrafica. Gli aggiornamenti che devono togliere un campo
passano da `setOrUnset` (`utils/mongo.js`).

Dopo aver pubblicato la correzione:

```bash
npm run maintenance:allinea-dati -- --remoto         # mostra cosa cambierebbe
npm run maintenance:allinea-dati -- --fix --remoto   # rimette in coda le consegne chiuse da una prova, toglie `simulata`
```

e un *Prepara* dalla pagina Consegne. A Zuel, simulato in sola lettura il
21/09/2026: chiude le 499 consegne del vecchio programma in coda - 488 "Già
consegnata il ...", 11 "Fattura del vecchio programma" - e mette in coda le 2
della fattura di prova 2026/A/1.

### Il ritardo delle scadenze e un valore derivato

Il ritardo **non e un campo salvato**: cresce di un giorno al giorno per le scadenze
non pagate, quindi qualunque valore memorizzato sarebbe gia vecchio l'indomani.
Viene ricalcolato a ogni lettura (`withComputedDelay`) e, per l'ordinamento della
lista, direttamente da MongoDB (`delayAggregation`).

Il campo e stato rimosso dai record e l'import non lo riporta piu. Se ricompare,
`npm run report:integrita` lo segnala e `npm run maintenance:allinea-dati -- --fix`
lo ripulisce.

### Otto fatture di Zuel puntano alla scadenza di un'altra

Tre scadenze sono richiamate da piu fatture - **Jump 3000** (2.000,00, tre
fatture del 2024), **Costruzioni Largura** (132,61, tre del 2025) e **Siorpaes
Luciano** (66,55, due del 2023) - e tre scadenze non le richiama nessuno. E il
difetto dell'import sulle scadenze descritto sopra: sono fatture di pari importo
nello stesso anno, e andavano tutte sulla prima scadenza trovata. Dove la
scadenza giusta esiste ancora, il recupero dei dati di Zuel le rimette a posto.

Nel frattempo non lascia residui: la cancellazione di una fattura elimina la
scadenza **solo se nessun'altra la richiama**
(`services/invoiceDeletionService.js`).

### Tre contatori di Zuel sono collegati all'edificio sbagliato

Su tre contatori l'edificio collegato non e quello scritto sulla loro scheda. In
Gesco il dato e giusto: e il difetto dell'import sulle matricole condivise. Ogni
matricola sta su due contatori di edifici diversi, e il primo e finito
nell'edificio del secondo:

| matricola | intestatario | edificio scritto sulla scheda | collegato a |
|---|---|---|---|
| 16292009 | Alberti Franca | CASA B | CASA D |
| 202923 | Denna Massimo | CONDOMINIO SAN MARCO B | CONDOMINIO SAN MARCO A |
| 9612864fisso4 | Impresa Edile Pizzolotto SRL | CAPANNONE F.LLI PIZZOLOTTO | CAPANNONE  PIZZOLOTTO |

Tutti e sei gli edifici esistono. Vanno ricollegati nel recupero dei dati di
Zuel; `report:integrita` non li segnala perche il collegamento e valido - punta a
un edificio che esiste.

### La penale per il ritardo si addebita una volta sola

I 6 euro di mora scattano guardando la scadenza precedente del cliente, e la
scadenza si segna con `mora_fatturata` appena la fattura esiste. Senza quella
memoria, due documenti emessi lo stesso giorno guarderebbero entrambi indietro
alla stessa scadenza aperta e il cliente pagherebbe la penale due volte: con 694
scadenze aperte non sarebbe un caso di scuola. Il gestionale precedente teneva il
campo "Fatturato ritardo" esattamente per questo.

Cancellando la fattura che portava la penale, la scadenza torna addebitabile.

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

## Trasmettere le fatture elettroniche

Il gestionale prepara i file; **come escono** lo decide `CANALE_TRASMISSIONE_SDI`:

| valore | cosa succede |
|--------|--------------|
| `intermediario` (predefinito) | il file resta in coda e si scarica con **XML** dalla pagina Consegne, per consegnarlo a chi trasmette |
| `pec` | il file parte da solo verso la PEC dello SdI |

**Il nome del file deve essere unico per sempre.** Lo SdI rifiuta un file il cui
nome ha gia visto, quindi ogni trasmissione si prende un progressivo nuovo da un
contatore dedicato (`trasmissioni`), che non riparte mai - nemmeno a inizio anno -
e viene scritto sulla consegna. Anche un secondo tentativo sulla stessa fattura
riceve un nome nuovo, altrimenti non si potrebbe rispedire una fattura scartata.

Il progressivo **non** si ricava dal numero della fattura: nell'archivio storico
un valore cosi ottenuto si ripeterebbe 499 volte, perche il gestionale precedente
numerava le fatture per cliente e non globalmente.

**Cosa manca ancora per l'invio davvero automatico**, in ordine di necessita:

1. **le ricevute dello SdI** (consegnata, scartata, mancata consegna): oggi nessuno
   le legge, quindi una fattura scartata resterebbe "inviata" senza che nessuno lo
   sappia. E il pezzo piu importante;
2. la **conservazione sostitutiva** a norma, dieci anni: di solito si affida a un
   servizio esterno;
3. i **recapiti**: 145 clienti su 900 hanno un codice SdI vero e 35 una PEC; per gli
   altri 720 la fattura va nel cassetto fiscale con `0000000`, che e corretto.

## Deploy

### Prima di mandare in produzione: i passaggi obbligatori

**1. Scrivere il ruolo sugli account che non ce l'hanno.**

```bash
npm run maintenance:allinea-dati            # mostra chi manca
npm run maintenance:allinea-dati -- --fix   # lo scrive
```

Il controllo dei permessi legge il ruolo dal record e **non ripiega piu su
`admin` quando il campo manca**. Era il ripiego sbagliato: un account del portale
che per un import o una modifica a mano perdesse il ruolo sarebbe diventato
amministratore. Gli account nati prima che il campo esistesse pero funzionavano
proprio grazie a quel ripiego, quindi **vanno sistemati prima di aggiornare il
server**, altrimenti non entrano piu. Chi ha un cliente collegato diventa
`cliente`, gli altri `admin`: e il permesso che hanno gia oggi.

Il server lo ricorda da solo: all'avvio, se trova account senza ruolo, li elenca
in console.

**2. Collegare i contatori sostituiti.**

Lo stesso comando collega ogni contatore a quello che ha sostituito, leggendo la
dichiarazione che il gestionale precedente lasciava nel seriale interno
("<codice del vecchio>_2"). Sono 13 sostituzioni, e si ricostruiscono senza
margine di errore: verificate una per una contro il report di Gesco.

I **subentri** - stessa matricola, intestatario diverso - non hanno un legame
scritto da nessuna parte. Ricavarli dall'ordine delle date era stato provato e
non funziona: su 138 coppie dichiarate da Gesco ne indovinava 117, ne sbagliava
21 e ne inventava 46. Il comando li conta e basta (125 matricole condivise): il
collegamento lo mette una persona, perche un legame sbagliato racconta una
storia falsa, che e peggio di una storia mancante.

**3. Collegare i contatori al loro edificio.**

Nell'archivio il nome dell'edificio arriva come testo (`nome_edificio`) e per 151
contatori **attivi** il collegamento vero non era mai stato scritto: sulla scheda
si leggeva "CASA DIMAI.FLORO", ma la relazione Edificio restava vuota e il
contatore non compariva sulla mappa. Chi va a leggere non lo trovava.

Lo stesso comando ne collega 149. Il criterio e stretto e verificabile: un solo
edificio con quel nome, e gli altri contatori con lo stesso nome - gia collegati
- puntano tutti li. Ognuno dei 149 ha quindi una seconda conferma indipendente.

I 2 rimasti sono elencati e vanno decisi a mano, perche il nome da solo non
basta: `161064558A` ("CASA B") e `9612864fisso3` ("CAPANNONE F.LLI PIZZOLOTTO").
Indovinare manderebbe l'operatore all'indirizzo sbagliato.

**4. Rimettere il punto decimale alle coordinate.**

Lo stesso comando corregge un edificio importato con la longitudine `12142838`
invece di `12.142838`. Finche non lo si esegue quell'edificio resta fuori dalla
mappa, contato fra quelli senza posizione: e cio che era gia successo in
produzione, dove la mappa mostrava il mondo intero perche doveva inquadrare
anche un punto dall'altra parte del pianeta.

**5. Controllare `JWT_SECRET` sul servizio.**

E il segreto con cui si firmano i token di accesso: chi lo conosce puo firmarsi
un accesso da amministratore. Il server ora **rifiuta di partire** se manca o se
e uno dei valori di esempio (`change-me`, `your_jwt_secret`, `secret`...), a meno
che `NODE_ENV` non dica `development` o `test`.

Prima il blocco scattava solo con `NODE_ENV=production` esatto: un deploy che si
dimenticava quella variabile partiva in silenzio con un segreto pubblico. Ora un
dubbio sull'ambiente chiude la porta invece di aprirla.

Se ne serve uno nuovo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Sotto i 32 caratteri il server parte ma avvisa in console.

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
