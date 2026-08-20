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
| Registrazione | Limitata a `MAX_ADMIN_USERS` amministratori (default 2). Gli account del portale clienti si creano dalla scheda cliente. |
| react-scripts 3 | Il client dipende da una versione del 2019 che richiede `--openssl-legacy-provider`. Funziona, ma e il debito tecnico piu rilevante del progetto. |

## Sincronizzazione con il database remoto

Lo script `documents/script/sync_databases.py` copia le collection fra remoto e
locale. Prima di una sincronizzazione delicata conviene sempre un giro a vuoto:

```bash
.venv/bin/python documents/script/sync_databases.py --direction pull --dry-run
```

La collection `users` resta esclusa per non sovrascrivere gli account.
