# Come funziona la fatturazione

Questo documento descrive il percorso che porta da una lettura del contatore alla
riga di fattura, con i punti in cui il calcolo puo fermarsi e il perche.

## I dati coinvolti

```
Cliente ──< Contatore ──> Listino ──< Fascia
                │
                └──< Lettura ──< Servizio (riga di fattura) >── Fattura ──> Scadenza
                                      │
                                      └──> Articolo (aliquota IVA)
```

- **Listino**: il piano tariffario. Non contiene prezzi.
- **Fascia**: uno scaglione del listino (`min`, `max`, `prezzo`) con una validita
  temporale (`inizio`, `scadenza`). Le fasce il cui `tipo` contiene "fisso" sono
  quote fisse, non scaglioni di consumo.
- **Articolo**: la voce fiscale. L'aliquota IVA si ricava dal testo del campo `iva`
  (`"IVA 10%"` produce 10). Testi senza percentuale (`"Esente art.15"`) danno 0.
- **Servizio**: una riga di fattura. Conserva uno `calcolo_snapshot` con i valori
  usati al momento del calcolo, cosi la fattura resta spiegabile anche se il
  listino cambia in seguito.

## Il campo `consumo` e un indice, non un consumo

`Lettura.consumo` contiene la **lettura del contatore**, cioe il totale progressivo.
Il consumo fatturabile e la differenza con la lettura precedente:

```
consumo fatturabile = max(0, lettura corrente - lettura precedente)
```

La lettura precedente e quella con `data_lettura` immediatamente antecedente sullo
stesso contatore (`getPreviousReading`). Il `max(0, ...)` protegge dai contatori
sostituiti, il cui indice riparte da zero: in quel caso il periodo non viene
fatturato invece di generare un importo negativo.

## Gli scaglioni

Le fasce usano estremi **inclusivi**: `1-100`, `101-150`, `151-200`. Il calcolo
converte questi estremi in un limite inferiore esclusivo (`min - 1`), quindi:

```
quantita di una fascia = max(0, min(consumo, max) - (min - 1))
```

Esempio con consumo 135 sul listino `1-100 @ 0,33` / `101-150 @ 0,73` / `151-200 @ 0,83`:

| Fascia    | Calcolo                   | Quantita | Importo |
|-----------|---------------------------|----------|---------|
| 1-100     | min(135, 100) - 0         | 100      | 33,00   |
| 101-150   | min(135, 150) - 100       | 35       | 25,55   |
| 151-200   | min(135, 200) - 150 -> <0 | 0        | -       |

Solo le fasce valide alla `data_lettura` e appartenenti al listino del contatore
entrano nel calcolo.

### Controllo di copertura

Dopo aver costruito le righe, il calcolo verifica che la somma dei metri cubi
fatturati coincida con il consumo. Se le fasce lasciano scoperta una parte del
consumo il calcolo **fallisce** con un errore 422 invece di emettere una fattura
incompleta:

> Il listino X copre 120 mc su 135 mc: aggiorna le fasce prima di generare la fattura

## La quota fissa

Le fasce di tipo "fisso" producono una riga a quantita 1 al prezzo della fascia.
La quota fissa e **annuale per contatore**: prima di applicarla il sistema verifica
che non sia gia stata fatturata nello stesso anno per quello stesso contatore
(`annualFixedChargeService`). Il controllo considera:

- le quote gia presenti in fatture con data precedente (`alreadyBilled`);
- le quote gia assegnate ad altre letture nella stessa generazione (`alreadySelected`);
- la richiesta esplicita di escluderla (`includeFixedCharge: false`).

Quando piu fasce fisse sono valide, viene scelta quella il cui intervallo contiene
il consumo; se nessuna corrisponde si usa la prima.

## Contatori condominiali

Un contatore e considerato "a riparto condominiale" quando il tipo contiene
"condominiale" insieme a "utenze private", "virtuale" o "ripartit", oppure quando
la quota `consumo` del contatore e diversa da 100.

Queste letture **non** vengono fatturate automaticamente: la generazione si ferma
con un errore 422, perche il riparto va calcolato sul contatore condominiale.
I contatori ripartiti usano gli articoli `COND` e `CONDF` invece di `ACQUA` e `ACQUAF`.

## Mora per ritardato pagamento

Se il cliente ha una fattura precedente la cui scadenza risulta gia superata alla
data della nuova fattura, viene aggiunta una riga con l'articolo `GG_DELAY` e
importo `INVOICE_DELAY_FEE` (default 6 EUR, esente IVA).

## Totali e IVA

```
imponibile = somma dei valore_unitario delle righe
IVA        = somma di (valore_unitario x aliquota / 100) di ogni riga
totale     = imponibile + IVA
```

L'IVA viene sommata riga per riga **senza arrotondamenti intermedi** e arrotondata
solo alla fine.

### Perche gli importi sono in centesimi interi

Tutta l'aritmetica monetaria passa da `utils/money.js` e lavora su **centesimi
interi**, non su numeri in virgola mobile. Il motivo e che i `Number` di
JavaScript non rappresentano esattamente i decimali: sommare diecimila volte
1 centesimo dava `100.00000000001425` invece di `100,00`, e l'arrotondamento
finiva per dipendere da come il numero era stato costruito invece che dal suo
valore. Su 300.000 casi di prova con mezzo centesimo esatto, l'aritmetica in
virgola mobile sbagliava 18.334 arrotondamenti; quella in centesimi interi zero.

Le aliquote sono espresse in **punti base** (10% = 1000) per restare intere anche
con percentuali frazionarie: l'IVA di piu righe si calcola sommando
`centesimi x punti base` e arrotondando una volta sola alla fine.

### Arrotondamento

Vale l'**arrotondamento commerciale**: il mezzo centesimo va sempre per eccesso
(9,095 diventa 9,10). Il conto si fa sulla rappresentazione decimale del valore,
non sulla sua approssimazione binaria.

> **Nota contabile.** Il gestionale precedente su alcuni di questi casi
> arrotondava per difetto: ricalcolando le 3.469 fatture storiche, 48 risultano
> diverse di 1 centesimo. La differenza rientra nella tolleranza dei controlli
> (`MONEY_TOLERANCE = 0,01`), quindi le verifiche non la segnalano come anomalia.
> La scelta e stata presa consapevolmente a favore del criterio standard.
>
> Resta invece invariato il **metodo** di calcolo dell'IVA: si somma l'imposta di
> tutte le righe e si arrotonda alla fine, invece di raggruppare per aliquota come
> fa la fatturazione elettronica. Sui dati storici il metodo attuale coincide nel
> 96,40% dei casi, il riepilogo per aliquota nel 96,11%. Cambiarlo significa
> intervenire su `calculateTotals` in `services/billingCalculator.js`.

## Numerazione

Il numero progressivo per anno e gestito dalla collection `invoice_counters`.
Prima di assegnare un numero il contatore viene allineato al massimo numero gia
presente per quell'anno (`$max`), poi incrementato. I numeri non vengono mai
riusati: una generazione fallita lascia un buco nella numerazione, ed e voluto.

## Transazioni

La generazione crea fattura, righe servizio, scadenza e blocca le letture. Su
MongoDB con replica set o Atlas tutto avviene in una **transazione**. Su MongoDB
standalone (lo scenario di sviluppo locale) le transazioni non esistono: la stessa
funzione viene rieseguita senza sessione e, in caso di errore, un rollback manuale
rimuove la fattura parziale e sblocca le letture (`rollbackGeneratedInvoice`).

## Blocco delle letture

Una lettura fatturata viene marcata `fatturata: true` e non puo entrare in una
seconda fattura. Il blocco viene rimosso quando la fattura viene cancellata
(vedi `services/invoiceDeletionService.js`).

## Fatture confermate

Una fattura con `confermata: true` (o `stato: 'confermata'`) e immutabile:
non si possono modificare i suoi campi, aggiungere o spostare righe servizio,
applicare la quota fissa o cancellarla. Il controllo e centralizzato in
`services/invoiceLockService.js`.

## Endpoint utili per capire un calcolo

```text
GET  /api/letture/:id/calcolo            anteprima del calcolo di una singola lettura
GET  /api/fatture/:id/verifica-calcolo   confronto fra righe salvate e ricalcolo
GET  /api/fatture/controlli              cruscotto anomalie su piu fatture
GET  /api/fatture/generazione/anteprima  clienti e letture pronti per la fatturazione
```

`verifica-calcolo` e il punto di partenza quando un totale non torna: mostra
`deltaLetture` (righe salvate contro ricalcolo), `deltaFattura` (testata contro
somma righe) e le righe che il listino attuale genererebbe ma che non sono presenti.
