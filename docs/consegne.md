# Come esce una fattura

Questo documento descrive cosa succede a una fattura dopo che e stata confermata:
dove deve andare, chi decide il canale, cosa parte da solo e cosa resta un lavoro
d'ufficio.

## Due cose diverse, tenute separate

Una fattura puo uscire due volte, e le due uscite non hanno la stessa natura.

**La copia di cortesia** e una scelta di chi gestisce l'acquedotto: posta, email,
PEC, ritiro allo sportello, oppure niente. Vive nel campo `stampa_cortesia` del
cliente ed e modificabile dall'anagrafica.

**La fattura elettronica** non e una scelta: il canale lo impone il destinatario.
Se ha un codice SdI il file va li; se ha solo la PEC va alla PEC; altrimenti resta
nel cassetto fiscale con `0000000`. Il gestionale lo deduce dai dati del cliente.
Metterlo a tendina significherebbe permettere di scegliere un canale che lo SdI
poi rifiuta.

```
Cliente.stampa_cortesia ──> copia di cortesia ──> email | PEC | posta | sportello
Cliente.codice_destinatario ─┐
Cliente.email_pec ───────────┴> fattura elettronica ──> SdI | PEC | cassetto
```

## Le modalita di consegna

Sono dichiarate una volta sola in `config/delivery.js`:

| Valore      | Etichetta             | Automatica | Recapito                     |
|-------------|-----------------------|------------|------------------------------|
| `email`     | Email                 | si         | `Cliente.email`              |
| `pec`       | PEC                   | si         | `Cliente.email_pec`          |
| `postale`   | Cartacea postale      | no         | indirizzo di fatturazione    |
| `sportello` | Ritiro allo sportello | no         | -                            |
| `nessuna`   | Nessuna copia         | no         | -                            |

"Automatica" significa che il gestionale puo percorrere quel canale da solo. Posta
e sportello restano in elenco: sono le fatture da stampare, e averle contate e
comunque utile.

### Il campo era testo libero

Nei dati importati `stampa_cortesia` vale `"Cartacea Postale"` su tutti e 900 i
clienti. Perche la tendina e i filtri funzionino, il valore viene ricondotto a
quelli della tabella:

- in scrittura, da un setter sul modello `Cliente`: da qui in avanti nel database
  finiscono solo i valori dichiarati;
- sui dati esistenti, con `npm run maintenance:allinea-dati -- --fix`, che riporta
  `"Cartacea Postale"` a `postale` senza cambiarne il significato. Sul database
  locale e gia stato eseguito; sul database di produzione va lanciato quando si
  vuole, perche le viste funzionano comunque;
- nelle viste della lista clienti, che accettano comunque entrambe le scritture,
  cosi il filtro funziona anche prima della normalizzazione.

## La coda delle consegne

Una consegna e un record della collezione `consegne`: una fattura, un tipo
(`cortesia` o `elettronica`), un canale, un recapito e uno stato.

```
in_coda ──> inviata ──> (rimetti da fare, solo se evasa a mano) ──> in_coda
   │  └───> errore ──> (riprova) ──> in_coda
   └──────> annullata ──> (Prepara) ──> in_coda
```

Esiste come record separato, e non come una data sulla fattura, perche i due
canali sono indipendenti: la copia di cortesia puo essere partita mentre la
fattura elettronica e ancora da trasmettere, e un tentativo fallito deve restare
visibile con il suo motivo invece di sparire.

Su una consegna si leggono due cose diverse, tenute in due campi:

| Campo | Cosa dice | Chi lo scrive e chi lo toglie |
|-------|-----------|-------------------------------|
| `problema` | cosa manca perche parta, secondo il piano di oggi: un recapito, un cliente estero | lo scrive e lo toglie *Prepara* |
| `ultimo_errore` | cosa e andato storto all'ultimo tentativo di farla uscire: l'invio, il file XML, la stampa | lo toglie un tentativo riuscito, *Riprova* o *Evasa*; *Prepara* no |

Tenerli in un campo solo faceva si che *Prepara* cancellasse l'errore di un file
XML, o che la stampa scrivesse sopra un indirizzo mancante. La colonna *Esito*
mostra prima l'errore, poi il problema, poi se la consegna e gia stata stampata
o scaricata, poi la nota; su una riga annullata, il motivo della chiusura.

Tre segni servono alla coda per ricordarsi come ci e arrivata una consegna:

- `su_richiesta` - messa in coda dalla scheda della fattura, o rimessa in coda
  con *Riprova* o *Rimetti da fare*: una richiesta esplicita, che il *Prepara*
  generale rispetta;
- `chiusa_dal_piano` - annullata da *Prepara* perche il piano non la prevedeva
  piu, e non da una persona: se il piano torna a prevederla, *Prepara* la riapre;
- `ultimo_tentativo` - l'ultimo tentativo che non l'ha consegnata, una prova o un
  errore: l'elaborazione parte da quelle mai tentate, poi da quelle tentate da
  piu tempo, cosi non riprova sempre le stesse.

E tre servono al lavoro d'ufficio:

- `stampata_il`, `scaricata_il` - quando la consegna e uscita l'ultima volta dalla
  stampa, o ne e stato scaricato l'XML. Non la chiudono: dicono che si puo segnare
  evasa insieme alle altre gia uscite. Li perde una consegna che torna da fare, e
  una a cui *Prepara* cambia il recapito: il documento uscito porta quello vecchio;
- `evasa_a_mano` - chiusa da una persona e non recapitata dal gestionale: solo
  questa, se e stato uno sbaglio, torna fra quelle da fare. Una mail partita non si
  ritira.

Una riga con un problema o un errore scritto sopra non conta come uscita. Una
copia senza indirizzo non si stampa nemmeno: si sistema la scheda del cliente, si
preme *Prepara* e torna fra quelle da stampare. Una fattura tornata bozza va
confermata di nuovo.

I filtri del lavoro d'ufficio - da stampare, gia stampate, da trasmettere, gia
scaricate - sono scritti una volta sola (`IN_UFFICIO` in `config/delivery.js`):
li usano la stampa, l'archivio XML, i conteggi della pagina e della panoramica e
la vista *Da stampare*, cosi i numeri che si leggono sono quelli su cui si lavora.
La stampa prende, fra quelle da stampare, le copie senza un problema: le altre
restano nel conteggio, perche sono ancora da fare, e la stampa dice quante sono.
Prima la panoramica contava le fatture elettroniche fra quelle da stampare.

> Le due date che il gestionale precedente teneva sulla fattura
> (`data_invio_fattura` e `data_fattura_elettronica`) continuano a essere
> popolate: chi guarda la fattura vede subito quando e uscita. La verita sullo
> stato dell'invio e pero nella consegna.

Cancellare una fattura cancella le sue consegne: una consegna senza documento non
ha significato e continuerebbe a comparire fra le fatture da recapitare.

### Le tre operazioni

1. **Pianifica** (`POST /api/consegne/pianifica`) mette in coda le consegne
   mancanti, con il recapito ricavato dall'anagrafica, e tiene la coda in pari
   con il piano. Non recapita nulla. Lavora in due modi:
   - dalla **pagina Consegne**, il pulsante *Prepara*: guarda **tutte** le fatture
     confermate emesse dal gestionale (quelle con la serie), piu quelle che hanno
     ancora una consegna aperta. Le fatture del vecchio programma restano fuori -
     vedi sotto;
   - dalla **scheda di una fattura**, con `{ fatture: [id] }`: guarda quella
     fattura, di qualunque provenienza, e riapre anche una consegna annullata,
     perche chi preme *Prepara* su quella fattura vuole che parta.

   Una consegna inviata non si tocca mai. Una aperta prende il recapito di oggi
   senza perdere l'errore del suo ultimo tentativo. Una che il piano non prevede
   piu si chiude con il motivo scritto; se l'ha chiusa il piano e il piano torna a
   prevederla - la fattura riportata a bozza e poi confermata - si riapre. Una
   annullata a mano resta annullata. Le regole sono in `aggiornamentoCoda`
   (`services/deliveryPlan.js`), senza database, e hanno i loro test.

   **I canali di una fattura si decidono una volta sola**, la prima volta che il
   Prepara generale la guarda: da allora la fattura porta il segno
   (`consegne_decise_il`). Un canale acceso dopo - il cliente passa alla fattura
   elettronica a fatturazione gia fatta - vale per le fatture da li in avanti:
   quelle gia emesse non si trasmettono a mesi di distanza. Quelle non aggiunte
   vengono contate e dette, perche una correzione in anagrafica non sembri non
   aver fatto niente; per una di quelle fatture si usa *Prepara* dalla sua
   scheda, che e una richiesta esplicita. Una fattura non pronta - una bozza, un
   cliente mancante - non prende il segno: la si guardera di nuovo.

   Fino al 21/09/2026 *Prepara* guardava le 500 fatture piu recenti, storico
   compreso. Una fatturazione di Zuel ne fa circa 670 con la stessa data: le altre
   restavano fuori per sempre, anche ripremendo, e le consegne aperte fuori da
   quella finestra non si chiudevano.
2. **Elabora** (`POST /api/consegne/elabora`) percorre la coda e recapita quelle
   automatiche, allegando il PDF della fattura. Prende prima quelle mai tentate,
   poi quelle tentate da piu tempo.
3. **Evadi** (`POST /api/consegne/:id/evasa`) chiude a mano una consegna che una
   persona ha portato a termine: la busta imbucata, la fattura ritirata. Tutte
   insieme, quelle gia uscite: `POST /api/consegne/evase` con `quali: 'stampate'`
   o `'scaricate'` chiude le copie gia stampate o le fatture elettroniche gia
   scaricate - a novembre, una per una, sarebbero ottocento clic. In blocco si
   chiude solo cio che e gia uscito dal gestionale: "tutte quelle da stampare"
   chiuderebbe buste mai stampate, e si rifiuta. E non si chiude una consegna
   la cui fattura e tornata bozza, o e cambiata dopo la stampa o lo scarico -
   corretta con lo sblocco: il documento uscito non e piu il suo. Perde il segno,
   la stampa o l'archivio successivo la rifanno, e la risposta dice quante
   (`daRifare`; regola in `chiudibiliInBlocco`, `services/deliveryPlan.js`).

   La fattura cambiata la dice il suo `updatedAt`, piu recente del segno; il
   segno porta l'ora di prima di leggere i dati, cosi anche una correzione
   salvata mentre si costruiva il file risulta successiva. Le date che la coda
   scrive sulla fattura - quando e uscita, quando ne ha deciso i canali - non
   toccano `updatedAt`: altrimenti chiudere la fattura elettronica farebbe
   sembrare cambiata la copia gia stampata. Del cliente, *Prepara* toglie il
   segno quando cambiano i campi che la consegna porta con se: il recapito
   (l'indirizzo della busta, il codice SdI o la PEC) e il nome dell'intestatario.
   Il resto - la destinazione stampata sulla busta, la provincia, l'indirizzo
   dentro l'XML, il codice fiscale, una scadenza - non si vede: dopo averlo
   cambiato, la copia gia uscita va rifatta a mano. Tenere la data di modifica
   anche su clienti e scadenze lo coglierebbe, ma chiederebbe di ristampare a
   ogni pagamento registrato.

   Evasa per sbaglio, una consegna torna da fare con `POST /api/consegne/:id/coda`
   (*Rimetti da fare*), e la fattura perde la data che le aveva dato; una partita
   dal gestionale no, e una evasa non si annulla.

Tre operazioni servono a portare fuori cio che non parte da solo. Nessuna chiude
una consegna: si stampa o si scarica, si controlla, e solo dopo la si segna evasa.

4. **Stampa** (`POST /api/consegne/stampa`) restituisce un solo PDF con le
   fatture da consegnare a mano, una per pagina, a blocchi di duecento nell'ordine
   delle buste. La stampa non sposta niente: finche non vengono segnate evase, la
   successiva ripete lo stesso blocco, cosi una stampa andata storta - la
   stampante inceppata, il PDF chiuso per sbaglio - si rifa premendo di nuovo.
   Nel blocco entrano prima quelle gia stampate e non ancora evase, poi le
   altre: anche se nel frattempo *Prepara* ha aggiunto fatture che vengono prima
   in ordine alfabetico, ripremendo escono tutte quelle che *Evase le stampate*
   chiuderebbe. Segnate evase le stampate, la stampa passa alle prossime. Una
   copia con un problema sulla riga - di solito manca l'indirizzo - non si
   stampa: tornerebbe in ogni blocco senza poter partire. Torna quando il
   problema e sistemato e *Prepara* lo toglie. La risposta dice quante aspettano
   dopo il blocco (`X-Consegne-Rimaste`) e quante restano fuori per un problema
   (`X-Consegne-Bloccate`). Le fatture e le loro righe si leggono in blocco: un
   blocco di duecento sono una decina di letture e circa un decimo di secondo
   (una fattura per volta erano oltre quattrocento andate e ritorni).
5. **XML** (`POST /api/consegne/xml`) restituisce un archivio zip con un file per
   ogni fattura elettronica da trasmettere, fino a mille: una fatturazione intera
   in un colpo. Una rifiutata - un cliente estero, un totale che non torna - resta
   fuori con il motivo sulla riga e non ferma le altre. I file si costruiscono una
   volta sola, i progressivi si prendono tutti insieme e solo per quelli riusciti,
   e le consegne si aggiornano con una scrittura sola: 677 file sono una decina di
   letture, una riserva di progressivi e una scrittura, in circa un quarto di
   secondo. Riscaricato, ogni file prende un nome nuovo. Un file fatto toglie
   dalla riga anche il problema che *Prepara* aveva visto: il tracciato rifa lo
   stesso controllo sul destinatario.
6. **XML della singola consegna** (`GET /api/consegne/:id/xml`), il pulsante
   *XML* sulla riga: lo stesso file dell'archivio, uno solo. Chi trasmette una
   fattura per volta scaricava lo zip di tutte per poi estrarne una, aprirla con
   un programma di compressione e rinominarla. Il file esce gia col nome della
   trasmissione.

Stampa e scarico lasciano sulla consegna il loro segno (`stampata_il`,
`scaricata_il`); la trasmissione automatica allo SdI no, perche di lei parla
l'esito dell'invio.

I due pulsanti XML lavorano sulle **fatture elettroniche in coda**: quando non
ce ne sono, quello generale resta spento e sulle righe non compare nulla. La
pagina dice perche - nessun cliente impostato per la fattura elettronica, oppure
coda momentaneamente vuota - invece di lasciar cercare un pulsante che non puo
esserci (`canaleSdiTesto`, lato client).

### Cosa la coda non prepara

**Le fatture del vecchio programma.** Il *Prepara* della pagina Consegne guarda
solo le fatture emesse dal gestionale; quelle importate da Gesco le ha
consegnate Gesco. Il loro storico e pieno di eccezioni che qui diventerebbero
lavoro da fare: a Zuel le fatture di dicembre del Comune, di Servizi Ampezzo e di
pochi altri non risultano mai trasmesse dal vecchio programma, ogni anno dal
2021, perche partono per altra via; le fatture singole del 2026 sono tutte
trasmesse come elettroniche, ma il vecchio programma non segnava la copia
cartacea. Il *Prepara* di prima ne proponeva venti. Le consegne aperte di queste
fatture si chiudono al *Prepara* successivo, con il motivo scritto, tranne quelle
chieste apposta dalla scheda: una singola fattura del vecchio programma si mette
in coda da li. Quelle chieste a mano restano, e il *Prepara* generale le tiene in
pari come tutte le altre - il recapito di una riga in coda non deve invecchiare -
chiudendole quando il piano non le prevede piu, per il motivo vero.

**Cio che e gia uscito.** Una fattura che ha gia la data di invio della copia
(`data_invio_fattura`) o di trasmissione allo SdI (`data_fattura_elettronica`)
non viene preparata di nuovo in quel modo (`CAMPO_DATA_CONSEGNA` in
`config/delivery.js`). Quasi tutte le fatture importate da Gesco sono gia state
spedite e trasmesse: prima della regola *Prepara* le rimetteva in coda - a Zuel
488 copie di cortesia su 499 erano di fatture gia spedite, e l'XML sarebbe
toccato a documenti gia passati dallo SdI. Le consegne aperte di questo tipo si
chiudono da sole alla successiva *Prepara*, con il motivo scritto: "Già
consegnata il ...". La data 01/01/1900 del vecchio programma vale "mai inviata".

**Chi il tracciato non sa servire.** Un cliente estero (nazione diversa
dall'Italia, o codice destinatario `XXXXXXX`) e un ufficio pubblico (codice IPA di
sei caratteri, formato FPA12) hanno regole proprie che il gestionale non gestisce
ancora. La riga in coda lo dice, e lo scarico dell'XML si rifiuta con lo stesso
motivo invece di produrre un file da privato italiano. Vanno emesse a parte.

> Il **Comune di Cortina** e una pubblica amministrazione, ma in anagrafica ha il
> codice destinatario generico `0000000`: finche non gli si scrive il suo codice
> IPA, il gestionale non puo riconoscerlo come tale.

### Una bozza non esce

Una fattura si consegna solo confermata. Il piano lo controlla quando la mette in
coda, e il controllo si ripete a ogni uscita, perche nel frattempo la fattura si
puo riportare a bozza: l'invio la mette in errore, l'XML si rifiuta, la stampa la
salta e lo scrive sulla riga (`isConfirmedInvoice` in `config/invoicing.js`,
`FATTURA_IN_BOZZA` in `services/deliveryPlan.js`). Il *Prepara* successivo chiude
le sue consegne; se la fattura viene confermata di nuovo, le riapre.

## Niente parte per sbaglio

Perche un messaggio esca servono **due condizioni insieme**:

```
INVIO_EMAIL_ABILITATO=true      e      SMTP_HOST configurato
```

Se ne manca una, l'elaborazione non fallisce: e una **prova**. Compone il
messaggio e il PDF ma non lo consegna, e la consegna **resta in coda** con l'esito
scritto sulla riga: partira davvero quando la posta sara attiva. Fino al
21/09/2026 una prova chiudeva la consegna come inviata (`simulata: true`): non
tornava piu in coda, e a posta attiva il cliente non avrebbe ricevuto niente.
`npm run maintenance:allinea-dati -- --fix` rimette in coda quelle chiuse cosi.

E deliberatamente scomodo. Una spedizione massiva partita per errore non si
annulla, e i destinatari sono i clienti dell'acquedotto.

C'e una terza rete di sicurezza: `INVIO_DESTINATARIO_PROVA`. Se valorizzata, ogni
messaggio va a quell'indirizzo invece che al cliente, con il destinatario vero
scritto nell'oggetto. Serve a provare l'invio completo, allegati compresi, senza
scrivere a nessuno.

Una prova **non** scrive la data di invio sulla fattura: direbbe il falso. Anche
una consegna deviata sull'indirizzo di prova e una prova: il messaggio e uscito,
ma il cliente non l'ha ricevuto.

### Configurazione

| Variabile                   | Predefinito              | A cosa serve                          |
|-----------------------------|--------------------------|---------------------------------------|
| `INVIO_EMAIL_ABILITATO`     | `false`                  | interruttore generale                 |
| `SMTP_HOST` / `SMTP_PORT`   | - / `587`                | server di posta                       |
| `SMTP_USER` / `SMTP_PASSWORD` | -                      | credenziali, se richieste             |
| `INVIO_MITTENTE`            | `INVOICE_COMPANY_EMAIL`  | indirizzo del mittente                |
| `INVIO_MITTENTE_NOME`       | `INVOICE_COMPANY_NAME`   | nome mostrato                         |
| `INVIO_RISPOSTE_A`          | -                        | indirizzo per le risposte             |
| `INVIO_DESTINATARIO_PROVA`  | -                        | devia ogni messaggio su un indirizzo  |

Il pulsante **Prova connessione** nella pagina Consegne verifica il server senza
spedire nulla.

## La fattura elettronica

Oggi il gestionale **prepara** il file e lo mette in elenco, ma non lo trasmette:
l'inoltro passa da un intermediario (commercialista o portale dell'Agenzia).
Lo dichiara `CANALE_TRASMISSIONE_SDI=intermediario`.

Il resto della catena e gia al suo posto. Con `CANALE_TRASMISSIONE_SDI=pec` il
file XML viene inoltrato da solo alla casella dello SdI
(`SDI_PEC_DESTINATARIO`, per impostazione predefinita `sdi01@pec.fatturapa.it`),
usando lo stesso trasporto delle email. Perche funzioni davvero servono una PEC
propria e l'accreditamento del canale: e una decisione amministrativa, non
tecnica.

> **Da confermare con chi tiene la contabilita.** Come l'acquedotto trasmette allo
> SdI oggi determina quale valore va in `CANALE_TRASMISSIONE_SDI`. Finche la
> risposta non arriva, la scelta prudente e lasciare `intermediario`: le consegne
> elettroniche restano in coda come promemoria e nessuna trasmissione parte a
> insaputa di nessuno.

### Il nome del file: un progressivo che non si ripete

Il file trasmesso si chiama `IT<partitaIva>_<progressivo>.xml`, e quel nome deve
essere **unico per sempre** presso lo SdI: un file con un nome gia visto viene
rifiutato. Il progressivo arriva quindi da un contatore dedicato
(`services/counters.js`, ambito `trasmissioni`) che non riparte mai, nemmeno a
gennaio, e viene scritto sulla consegna.

Ogni tentativo ne prende uno nuovo, anche il secondo sulla stessa fattura: e
questo che permette di **rispedire una fattura scartata**. Un progressivo dedotto
da anno e numero non potrebbe cambiare - e nell'archivio storico si ripeterebbe
499 volte, perche il gestionale precedente numerava le fatture per cliente e non
globalmente.

### Cosa manca per l'invio davvero automatico

1. **Le ricevute dello SdI** (consegnata, scartata, mancata consegna): oggi nessuno
   le legge, quindi una fattura scartata resterebbe "inviata" senza che nessuno lo
   sappia. E il pezzo piu importante, e va costruito prima di accendere il canale
   automatico;
2. la **conservazione sostitutiva** a norma, dieci anni: di solito si affida a un
   servizio esterno.

### Per quali clienti

Una consegna elettronica viene preparata solo per chi la riceve, cioe per i
clienti con `fattura_elettronica: true`. La spunta viene da Gesco: l'import
vecchio non la leggeva, e dal 21/09/2026 e stata riletta (`npm run gesco:spunte`,
vedi [manutenzione](manutenzione.md)). `FATTURA_ELETTRONICA_PREDEFINITA=true` la
attiva per tutti senza toccare le anagrafiche.

## Cosa dicono i dati oggi

Zuel, produzione, 21/09/2026:

| Dato                                    | Valore    |
|-----------------------------------------|-----------|
| Clienti con consegna `postale`          | 901 su 902 |
| Clienti con un indirizzo email          | 215 (24%)  |
| Clienti con una PEC                     | 35 (4%)    |
| Clienti con un codice destinatario reale | 145 (16%) |
| Clienti con `fattura_elettronica` attivo | 899       |

La conseguenza pratica: **la consegna per email oggi coprirebbe un quarto dei
clienti**. Prima di passare all'invio automatico su larga scala il lavoro vero non
e tecnico, e raccogliere gli indirizzi.

## Dove guardare nel codice

| File                             | Cosa contiene                                  |
|----------------------------------|------------------------------------------------|
| `config/delivery.js`             | modalita, canali, testi dei messaggi           |
| `services/deliveryPlan.js`       | dove deve andare una fattura, e come cambia la coda (nessun database) |
| `services/deliveryService.js`    | la coda: pianifica, elabora, registra          |
| `services/documentiConsegna.js`  | i file: PDF, XML, stampa delle buste, archivio |
| `services/mailer.js`             | l'unico punto in cui un messaggio esce         |
| `models/Consegna.js`             | il record di una consegna                      |
| `controllers/ConsegnaController.js` | le rotte `/api/consegne`                    |

Le regole di `deliveryPlan.js` non toccano il database: si possono verificare con
i test (`tests/delivery.test.js`) e valgono sia per l'anteprima nell'interfaccia
sia per la coda vera.
