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
  `"Cartacea Postale"` a `postale` senza cambiarne il significato;
- nelle viste della lista clienti, che accettano comunque entrambe le scritture,
  cosi il filtro funziona anche prima della normalizzazione.

## La coda delle consegne

Una consegna e un record della collezione `consegne`: una fattura, un tipo
(`cortesia` o `elettronica`), un canale, un recapito e uno stato.

```
in_coda ──> inviata
   │  └───> errore ──> (riprova) ──> in_coda
   └──────> annullata
```

Esiste come record separato, e non come una data sulla fattura, perche i due
canali sono indipendenti: la copia di cortesia puo essere partita mentre la
fattura elettronica e ancora da trasmettere, e un tentativo fallito deve restare
visibile con il suo motivo invece di sparire.

> Le due date che il gestionale precedente teneva sulla fattura
> (`data_invio_fattura` e `data_fattura_elettronica`) continuano a essere
> popolate: chi guarda la fattura vede subito quando e uscita. La verita sullo
> stato dell'invio e pero nella consegna.

Cancellare una fattura cancella le sue consegne: una consegna senza documento non
ha significato e continuerebbe a comparire fra le fatture da recapitare.

### Le tre operazioni

1. **Pianifica** (`POST /api/consegne/pianifica`) guarda le fatture confermate e
   crea le consegne mancanti, con il recapito ricavato dall'anagrafica. Non
   recapita nulla. Una consegna gia inviata non viene mai riscritta.
2. **Elabora** (`POST /api/consegne/elabora`) percorre la coda e recapita quelle
   automatiche, allegando il PDF della fattura.
3. **Evadi** (`POST /api/consegne/:id/evasa`) chiude a mano una consegna che una
   persona ha portato a termine: la busta imbucata, la fattura ritirata.

## Niente parte per sbaglio

Perche un messaggio esca servono **due condizioni insieme**:

```
INVIO_EMAIL_ABILITATO=true      e      SMTP_HOST configurato
```

Se ne manca una, l'elaborazione non fallisce: compone il messaggio, lo registra
come **simulato** e non lo consegna. Il conteggio nell'interfaccia resta reale e
si vede esattamente quante fatture sarebbero partite e verso dove.

E deliberatamente scomodo. Una spedizione massiva partita per errore non si
annulla, e i destinatari sono i clienti dell'acquedotto.

C'e una terza rete di sicurezza: `INVIO_DESTINATARIO_PROVA`. Se valorizzata, ogni
messaggio va a quell'indirizzo invece che al cliente, con il destinatario vero
scritto nell'oggetto. Serve a provare l'invio completo, allegati compresi, senza
scrivere a nessuno.

Una consegna simulata **non** scrive la data di invio sulla fattura: direbbe il
falso.

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

### Per quali clienti

Una consegna elettronica viene preparata solo per chi la riceve, cioe per i
clienti con `fattura_elettronica: true`. Sui dati importati il flag e falso su
tutti e 900, quindi oggi non ne viene preparata nessuna.

Quando la decisione sara presa ci sono due strade:

- accendere il flag sui clienti interessati, dall'anagrafica;
- oppure `FATTURA_ELETTRONICA_PREDEFINITA=true`, che la attiva per tutti senza
  toccare 900 anagrafiche.

## Cosa dicono i dati oggi

| Dato                                    | Valore    |
|-----------------------------------------|-----------|
| Clienti con modalita "Cartacea Postale" | 900 (100%) |
| Clienti con un indirizzo email          | 213 (24%)  |
| Clienti con una PEC                     | 35 (4%)    |
| Clienti con un codice destinatario reale | 146 (16%) |
| Clienti con `fattura_elettronica` attivo | 0         |

La conseguenza pratica: **la consegna per email oggi coprirebbe un quarto dei
clienti**. Prima di passare all'invio automatico su larga scala il lavoro vero non
e tecnico, e raccogliere gli indirizzi.

## Dove guardare nel codice

| File                             | Cosa contiene                                  |
|----------------------------------|------------------------------------------------|
| `config/delivery.js`             | modalita, canali, testi dei messaggi           |
| `services/deliveryPlan.js`       | dove deve andare una fattura (nessun database) |
| `services/deliveryService.js`    | la coda: pianifica, elabora, registra          |
| `services/mailer.js`             | l'unico punto in cui un messaggio esce         |
| `models/Consegna.js`             | il record di una consegna                      |
| `controllers/ConsegnaController.js` | le rotte `/api/consegne`                    |

Le regole di `deliveryPlan.js` non toccano il database: si possono verificare con
i test (`tests/delivery.test.js`) e valgono sia per l'anteprima nell'interfaccia
sia per la coda vera.
