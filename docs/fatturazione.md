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

> **Le tariffe scadono, e con loro la fatturazione.** Quasi tutte le fasce in uso
> scadono il **31/12/2026**: dal giorno dopo il calcolo si rifiuta di emettere,
> perche non ha un prezzo da applicare. E il comportamento giusto, ma va saputo
> prima. `npm run report:integrita` elenca i listini le cui tariffe scadono entro
> sei mesi, con quanti contatori ciascuno.

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
"condominiale" **e** almeno una fra: "utenze private", "virtuale", "ripartit", o
una quota `consumo` maggiore di zero e diversa da 100. Vale anche quando
l'attivita e "utenza condominiale" e il tipo contiene "ripartit".

La quota da sola non basta, ed e voluto: 140 contatori hanno `consumo: 0` e 915
non ce l'hanno affatto: interpretarli come ripartiti bloccherebbe la
fatturazione di quasi tutto l'acquedotto. Sui dati attuali la regola seleziona
**6 contatori**.

Queste letture **non** vengono fatturate automaticamente: la generazione si ferma
con un errore 422, perche il riparto va calcolato sul contatore condominiale.
I contatori ripartiti usano gli articoli `COND` e `CONDF` invece di `ACQUA` e `ACQUAF`.

### Come lo faceva il gestionale precedente

Il contatore condominiale legge il totale, e il consumo viene attribuito in
percentuale ai contatori privati collegati. Ogni lettura del condominiale
produce, per ciascuna utenza, una riga di consumo e una di quota fissa,
entrambe ridotte alla sua percentuale:

```text
Spesa Acqua cont. condominiale. Su Seriale:07496473 Perc. 33   mc 14,3319   4,729527
Spesa Acqua cont. condominiale. Su Seriale:07496473 Perc. 33   mc  0,3333  11,665500
```

Nei dati c'e un solo condominio reale, tre utenze al 33,33 / 33,34 / 33,33 su un
contatore ripartito, piu un contatore "virtuale" senza letture. Oggi il riparto
si fa a mano.

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

L'IVA viene sommata riga per riga e arrotondata **una sola volta, alla fine**.

L'imposta si calcola pero sugli importi di riga **arrotondati al centesimo**, non
sul loro valore pieno: se la riga dice 4,73 la base imponibile e 4,73, non
4,729527. Sui riparti condominiali importati, che hanno sei decimali, calcolarla
sul valore pieno dava un centesimo in meno su tre fatture. E anche il criterio
che vuole il riepilogo della fattura elettronica, che somma gli importi di riga a
due decimali: le due sezioni del documento devono tornare fra loro.

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

I documenti emessi da questo gestionale usano una **serie di numerazione
dedicata** (`INVOICE_SERIES`, default `A`), separata dallo storico importato.

Il motivo e nei dati: nelle fatture importate il campo `numero` **non e** un
progressivo di fattura ma un codice cliente. Arriva a 6343 in ogni anno e la
coppia (anno, numero) si ripete su 2.745 documenti su 3.469; il campo `codice`
contiene a sua volta il codice del cliente, uguale su tutte le sue fatture.
Agganciare la numerazione nuova a quei valori significava partire da numeri
arbitrari e non poter garantire l'unicita.

Con la serie dedicata:

- il progressivo riparte da **1 a ogni anno** e non dipende dallo storico;
- il codice del documento e `anno/serie/numero`, per esempio `2026/A/1`;
- un indice unico parziale su `(anno, serie, numero)` impedisce i duplicati.
  E parziale perche sullo storico, privo di serie, non sarebbe applicabile;
- le fatture importate restano com'erano e non entrano in conflitto: hanno
  numeri uguali ma serie assente, quindi sono distinguibili.

> La lettera della serie va concordata con chi tiene la contabilita: e una scelta
> fiscale, non tecnica. Si cambia con `INVOICE_SERIES` e vale dalla fattura
> successiva; le fatture gia emesse mantengono la loro.

I numeri non vengono mai riusati: una generazione fallita lascia un buco nella
numerazione, ed e voluto.

## Fattura elettronica (XML)

`GET /api/fatture/:id/xml` produce il file nel tracciato **FatturaPA 1.2**
(`services/invoiceXml.js`), scaricabile anche dal pulsante **XML** nella scheda
della fattura.

> **Oggi il gestionale non trasmette nulla.** Genera il file e lo mette in coda
> fra le consegne. L'inoltro al Sistema di Interscambio passa da un intermediario
> - commercialista o portale dell'Agenzia - perche il file e identico in ogni
> scenario. La catena per trasmettere da soli esiste gia ed e configurabile:
> vedi [Come esce una fattura](consegne.md).

Sui dati attuali **3.351 fatture su 3.472 (97%)** sono emettibili. Le 121 che non
lo sono coincidono esattamente con quelle prive di cliente collegato: non e un
problema di dati fiscali.

### Scelte che vanno confermate da chi tiene la contabilita

Il tracciato obbliga a dichiarare alcune cose che il gestionale non puo dedurre.
Sono raccolte in `config/invoicing.js`, non sparse nel codice, e vanno riviste:

| Voce | Valore attuale | Nota |
|------|----------------|------|
| `RegimeFiscale` | `RF01` (ordinario) | `INVOICE_TAX_REGIME` |
| Natura per *Esente art.15* | `N1` | righe della mora |
| Natura per *Art.26 DPR 633/72* | `N2.2` | rimborsi |
| Natura per *NI90* | `N3.5` | |

Una riga senza imposta e senza natura corrispondente **blocca l'emissione**: e
voluto. Un documento formalmente valido ma con la natura sbagliata e peggio di
uno non emesso, perche viene accettato e resta errato.

### Tipo di documento

Il tracciato vuole dichiarare che documento e: `TD01` per la fattura, `TD04` per
la nota di credito, `TD05` per la nota di debito. Il valore si ricava dal campo
`tipo_documento`, che nei dati importati vale "Fattura" su 3.467 documenti e
"Nota di Credito" su 5.

Un tipo non riconosciuto **blocca l'emissione** invece di ricadere sulla fattura:
un documento accettato dallo SdI che dichiara di essere cio che non e sarebbe
peggio di uno non emesso. La corrispondenza sta in `config/invoicing.js`.

> Le note di credito importate hanno importi **positivi**: nel tracciato il segno
> lo porta il tipo di documento, non gli importi. Nessuna conversione e applicata.

### Il totale deve tornare con i suoi riepiloghi

Il Sistema di Interscambio ricalcola il documento: somma gli imponibili e le
imposte dei riepiloghi per aliquota e li confronta con
`ImportoTotaleDocumento`. **Un centesimo di scarto fa scartare il file.**

Per questo il totale scritto nell'XML e quello dei riepiloghi, e prima di
emettere si verifica che coincida con il totale salvato sulla fattura. Se non
coincide l'emissione si ferma, dicendo entrambi i valori: il gestionale non
riscrive il totale di un documento (l'XML dichiarerebbe un importo diverso da
quello sulla carta) e non produce un file che verrebbe rifiutato.

Sui dati attuali questo riguarda **129 fatture importate**, il cui totale salvato
dal gestionale precedente non torna con le proprie righe per via del suo
arrotondamento. Erano documenti che il vecchio sistema ha comunque emesso; da qui
non si possono riemettere senza prima correggerli.

Le fatture prodotte da questo gestionale non hanno il problema per costruzione:
il totale nasce dalla somma delle righe.

### Conversioni applicate

- La **provincia** passa dal nome esteso alla sigla di due lettere
  (`utils/province.js`): l'anagrafica importata contiene "Belluno", il tracciato
  vuole "BL".
- Gli **accenti** vengono rimossi dai campi liberi, come richiede il tracciato.
- Il **codice destinatario** deve essere di 6 o 7 caratteri alfanumerici: un valore
  malformato vale come codice assente e diventa `0000000`. E lo stesso giudizio con
  cui si sceglie il canale della consegna (`config/delivery.js`), cosi il tracciato
  e la coda di consegna non possono dire due cose diverse sullo stesso cliente.

## Modifica di una fattura confermata

Una fattura confermata e protetta: modifiche, cancellazione e righe servizio
sono rifiutate con `409`. Il blocco puo pero essere superato dichiarandolo, con
`sbloccoConfermato` nel corpo della richiesta o nella querystring.

Non e una scorciatoia silenziosa: l'operazione viene registrata nel giornale con
l'azione `fattura.modificata_dopo_conferma`, cosi resta distinguibile da una
modifica ordinaria su una bozza. Nell'interfaccia il pulsante chiede conferma
esplicita prima di procedere.

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

## Consegna al cliente

Confermare una fattura non la fa uscire. Dove va a finire, chi la riceve e cosa e
gia partito sono descritti in [Come esce una fattura](consegne.md): la copia di
cortesia segue la modalita scelta sul cliente, la fattura elettronica il canale
dedotto da codice destinatario e PEC.
