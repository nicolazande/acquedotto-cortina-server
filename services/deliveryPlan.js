// Dove deve andare una fattura, e come cambia la coda di conseguenza, deciso
// senza toccare il database.
//
// Il modulo risponde a due domande. Dato un cliente e una fattura: quali
// consegne servono, su quale canale, verso quale recapito, e cosa manca perche
// possano partire. Date le fatture da guardare e le consegne che hanno gia:
// cosa creare, cosa aggiornare e cosa chiudere. Nessuna scrittura, nessun
// invio: cosi le regole si possono verificare con i test e riusare sia per
// l'anteprima nell'interfaccia sia per la coda vera.

const {
    CAMPO_DATA_CONSEGNA,
    CANALE_TRASMISSIONE_SDI,
    STATI_APERTI,
    canaleFatturaElettronica,
    destinatarioNonGestito,
    modalitaConsegna,
    richiedeFatturaElettronica,
} = require('../config/delivery');
const { customerLabel } = require('../utils/customer');
const { emessaDalGestionale, invoiceCode, isConfirmedInvoice } = require('../config/invoicing');
const { dataReale, formatItalianDate } = require('../utils/dates');
const { setOrUnset, soloValorizzati } = require('../utils/mongo');

// Controllo volutamente permissivo: serve a intercettare i campi rimasti vuoti
// o con del testo al posto dell'indirizzo, non a validare le RFC.
const EMAIL_PLAUSIBILE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const testo = (valore) => String(valore ?? '').trim();

const primoValorizzato = (...valori) => valori.map(testo).find(Boolean) || '';

// L'indirizzo di spedizione: quello di fatturazione quando c'e, altrimenti la
// residenza. E lo stesso criterio usato dal PDF della fattura.
const indirizzoPostale = (cliente) => {
    const via = primoValorizzato(cliente?.indirizzo_fatturazione, cliente?.indirizzo_residenza);
    const numero = primoValorizzato(cliente?.numero_fatturazione, cliente?.numero_residenza);
    const cap = primoValorizzato(cliente?.cap_fatturazione, cliente?.cap_residenza);
    const localita = primoValorizzato(cliente?.localita_fatturazione, cliente?.localita_residenza);

    if (!via || !localita) {
        return '';
    }

    return [[via, numero].filter(Boolean).join(' '), [cap, localita].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(' - ');
};

const recapitoEmail = (valore, etichetta) => {
    const indirizzo = testo(valore);

    if (!indirizzo) {
        return { destinatario: '', problema: `Il cliente non ha ${etichetta}.` };
    }

    if (!EMAIL_PLAUSIBILE.test(indirizzo)) {
        return { destinatario: indirizzo, problema: `${etichetta} del cliente non sembra un indirizzo valido.` };
    }

    return { destinatario: indirizzo, problema: null };
};

// La copia di cortesia: e la scelta registrata sul cliente.
const consegnaCortesia = (cliente) => {
    const modalita = modalitaConsegna(cliente);

    if (modalita.canale === 'nessuno') {
        return null;
    }

    const base = {
        tipo: 'cortesia',
        canale: modalita.canale,
        modalita: modalita.value,
        automatico: modalita.automatica,
    };

    if (modalita.canale === 'email') {
        return { ...base, ...recapitoEmail(cliente?.email, 'un indirizzo email') };
    }

    if (modalita.canale === 'pec') {
        return { ...base, ...recapitoEmail(cliente?.email_pec, 'una casella PEC') };
    }

    if (modalita.canale === 'postale') {
        const indirizzo = indirizzoPostale(cliente);
        return {
            ...base,
            destinatario: indirizzo,
            problema: indirizzo ? null : 'Il cliente non ha un indirizzo di spedizione.',
        };
    }

    return { ...base, destinatario: 'Ritiro allo sportello', problema: null };
};

// La fattura elettronica: il canale lo impone il destinatario, non l'operatore.
const consegnaElettronica = (cliente) => {
    if (!richiedeFatturaElettronica(cliente)) {
        return null;
    }

    const { canale, destinatario, etichetta } = canaleFatturaElettronica(cliente);

    return {
        tipo: 'elettronica',
        canale,
        destinatario,
        etichetta,
        // Finche la trasmissione passa da un intermediario il gestionale prepara
        // il file e lo mette in elenco, ma non lo inoltra: e una scelta di
        // configurazione, non un limite del codice.
        automatico: CANALE_TRASMISSIONE_SDI !== 'intermediario',
        // Sulla riga della coda si legge subito perche quel file non uscira.
        problema: destinatarioNonGestito(cliente),
        nota: CANALE_TRASMISSIONE_SDI === 'intermediario'
            ? 'Trasmissione affidata a un intermediario: il file va scaricato e inoltrato.'
            : null,
    };
};

// Una fattura si consegna solo confermata (`isConfirmedInvoice`): una bozza puo
// ancora cambiare. Vale quando entra in coda e di nuovo quando esce, perche nel
// frattempo la si puo riportare a bozza (services/documentiConsegna.js, e
// l'elaborazione della coda).
const FATTURA_IN_BOZZA = 'La fattura è una bozza: va confermata prima di consegnarla.';

// Motivi per cui una fattura non e ancora pronta per essere consegnata.
// Sono errori sul documento, non sul recapito: valgono per tutti i canali.
const ostacoliDocumento = ({ cliente, fattura }) => {
    const ostacoli = [];

    if (!cliente) {
        ostacoli.push('La fattura non ha un cliente collegato.');
    }

    if (fattura && !isConfirmedInvoice(fattura)) {
        ostacoli.push(FATTURA_IN_BOZZA);
    }

    return ostacoli;
};

// Le consegne che la fattura ha gia avuto, con la loro data. Quasi tutte le
// fatture importate da Gesco sono gia state trasmesse allo SdI e spedite:
// prepararle di nuovo voleva dire ristamparle o, peggio, ritrasmetterle.
const consegneGiaFatte = (fattura) => Object.entries(CAMPO_DATA_CONSEGNA)
    .map(([tipo, campo]) => ({ tipo, data: dataReale(fattura?.[campo]) }))
    .filter(({ data }) => data);

// Il piano completo di una fattura: cosa deve partire, dove, e cosa lo blocca.
const pianoConsegne = ({ cliente, fattura }) => {
    const ostacoli = ostacoliDocumento({ cliente, fattura });
    const giaConsegnate = consegneGiaFatte(fattura);
    const consegne = ostacoli.length
        ? []
        : [consegnaCortesia(cliente), consegnaElettronica(cliente)]
            .filter(Boolean)
            .filter((consegna) => !giaConsegnate.some((fatta) => fatta.tipo === consegna.tipo));

    return {
        fattura: fattura?._id,
        cliente: cliente?._id,
        // Le fatture importate non hanno serie: per loro l'etichetta resta
        // anno/numero, che e come compaiono nello storico.
        documento: invoiceCode(fattura || {}) || [fattura?.anno, fattura?.numero].filter(Boolean).join('/'),
        intestatario: customerLabel(cliente, fattura),
        // Una fattura del vecchio programma entra in coda solo dalla sua scheda:
        // la scheda lo dice, cosi non la si cerca invano nella pagina Consegne.
        emessaDalGestionale: emessaDalGestionale(fattura),
        ostacoli,
        consegne,
        giaConsegnate,
        pronta: ostacoli.length === 0 && consegne.some((consegna) => !consegna.problema),
    };
};

// ---------------------------------------------------------------------------
// La coda
// ---------------------------------------------------------------------------

// I campi di una consegna che vengono dal piano: canale, recapito, il problema
// che il piano vede oggi, ed etichette. Tenere qui l'etichetta e il nome del
// cliente evita di ripopolare due relazioni ogni volta che si guarda la coda.
// Un campo vuoto vale "da togliere": un problema risolto in anagrafica non deve
// restare scritto sulla riga.
const campiDalPiano = (piano, consegna) => ({
    fattura: piano.fattura,
    cliente: piano.cliente,
    tipo: consegna.tipo,
    canale: consegna.canale,
    destinatario: consegna.destinatario,
    documento: piano.documento,
    intestatario: piano.intestatario,
    automatica: consegna.automatico,
    problema: consegna.problema || null,
});

// Una consegna che parte da capo, nuova o riaperta: in coda, con la nota del suo
// canale e senza gli errori dei tentativi di prima, ne il motivo di un
// annullamento.
const daCapo = (piano, consegna) => ({
    ...campiDalPiano(piano, consegna),
    stato: 'in_coda',
    ultimo_errore: null,
    note: consegna.nota || null,
    chiusa_dal_piano: null,
});

// Una consegna gia in coda prende i campi del piano di oggi senza perdere cio
// che le e successo: l'errore dell'ultimo tentativo resta, con il suo stato,
// finche un tentativo non riesce o una persona non la rimette in coda, e resta
// l'esito di una prova se il canale non ha una nota sua. Fa eccezione la bozza:
// e una condizione, non un guasto, e se il piano prevede la consegna la fattura
// e confermata e la condizione non c'e piu.
const aggiornata = (piano, consegna, esistente) => {
    const campi = campiDalPiano(piano, consegna);

    if (consegna.nota) {
        campi.note = consegna.nota;
    }

    if (esistente.ultimo_errore === FATTURA_IN_BOZZA) {
        Object.assign(campi, { ultimo_errore: null, stato: 'in_coda' });
    }

    return campi;
};

// Se un aggiornamento cambia davvero la consegna. Senza questo controllo ogni
// Prepara riscriveva tutte le consegne aperte - 1.341 per una fatturazione - e
// diceva di averle aggiornate anche quando non era cambiato niente.
const stessoValore = (a, b) => String(a ?? '') === String(b ?? '');

const cambiaQualcosa = (esistente, { $set = {}, $unset = {} }) => (
    Object.entries($set).some(([campo, valore]) => !stessoValore(esistente[campo], valore))
    || Object.keys($unset).some((campo) => esistente[campo] !== undefined && esistente[campo] !== null)
);

// La chiusura di una consegna, da Prepara o da una persona. Il problema e
// l'ultimo errore descrivevano una consegna da fare: sulla riga chiusa si legge
// il motivo. Solo Prepara la segna come chiusa dal piano: e cio che puo riaprire.
const chiusura = (note, dalPiano = false) => setOrUnset({
    stato: 'annullata',
    note,
    chiusa_dal_piano: dalPiano || null,
    problema: null,
    ultimo_errore: null,
});

// Perche una consegna aperta esce dalla coda, detto sulla riga.
const motivoDellaChiusura = ({ piano, consegna, dalloStorico }) => {
    const fatta = piano.giaConsegnate.find((voce) => voce.tipo === consegna.tipo);

    if (fatta) {
        return `Già consegnata il ${formatItalianDate(fatta.data)}: non va ripetuta.`;
    }

    if (dalloStorico) {
        return 'Fattura del vecchio programma: la coda generale non la prepara. '
            + 'Per consegnarla da qui si usa Prepara nella sua scheda.';
    }

    return piano.ostacoli.length ? piano.ostacoli.join(' ') : 'Non più prevista dal piano di consegna.';
};

// Come cambia la coda con un "Prepara".
//
// `fatture` sono le fatture da guardare, ciascuna col suo cliente, ed
// `esistenti` le consegne che hanno gia. `suRichiesta` distingue le due strade:
// la scheda di una fattura chiede quella fattura, qualunque sia la sua
// provenienza; la coda generale guarda le fatture emesse dal gestionale e
// rimette in pari le consegne aperte.
//
// Le regole:
//  - una consegna prevista e mancante si crea; se c'e ed e aperta si aggiorna
//    col recapito di oggi; se e gia inviata non si tocca mai;
//  - una consegna aperta che il piano non prevede piu si chiude, col motivo, e
//    resta segnata come chiusa dal piano;
//  - una consegna annullata torna in coda se il piano la prevede di nuovo e
//    l'aveva chiusa lui - la fattura riportata a bozza e poi confermata, il
//    cliente che ha ritrovato il recapito. Una annullata da una persona resta
//    annullata: la rimette in coda solo la scheda della fattura, perche chi preme
//    Prepara su quella fattura vuole che parta;
//  - nella coda generale una fattura del vecchio programma non ha consegne
//    previste. Il suo storico e pieno di eccezioni che qui diventerebbero
//    lavoro da fare: le fatture di dicembre che ogni anno partono per altra
//    via, le copie cartacee che il vecchio programma non segnava. Le sue
//    consegne aperte si chiudono, tranne quelle chieste apposta dalla scheda.
const aggiornamentoCoda = ({ fatture, esistenti, suRichiesta = false }) => {
    const perFattura = Map.groupBy(esistenti, (consegna) => String(consegna.fattura));

    const esito = { operazioni: [], problemi: [], create: 0, aggiornate: 0, riaperte: 0, annullate: 0, saltate: 0 };
    // Ogni scrittura vale solo se la consegna e ancora nello stato letto: una
    // partita mentre Prepara lavorava non va riaperta, aggiornata o chiusa.
    const scrivi = (esistente, stati, update) => esito.operazioni.push({
        updateOne: { filter: { _id: esistente._id, stato: { $in: stati } }, update },
    });

    fatture.forEach((fattura) => {
        const piano = pianoConsegne({ cliente: fattura.cliente, fattura });
        const sue = perFattura.get(String(fattura._id)) || [];
        const dalloStorico = !suRichiesta && !piano.emessaDalGestionale;
        const previste = dalloStorico ? [] : piano.consegne;
        const richiesta = suRichiesta ? { su_richiesta: true } : {};

        if (!dalloStorico) {
            piano.ostacoli.forEach((messaggio) => esito.problemi.push({
                fattura: fattura._id,
                documento: piano.documento,
                messaggio,
            }));
        }

        previste.forEach((consegna) => {
            const esistente = sue.find((voce) => voce.tipo === consegna.tipo);

            if (!esistente) {
                esito.operazioni.push({ insertOne: { document: soloValorizzati({ ...daCapo(piano, consegna), ...richiesta }) } });
                esito.create += 1;
            } else if (STATI_APERTI.includes(esistente.stato)) {
                const aggiornamento = setOrUnset({ ...aggiornata(piano, consegna, esistente), ...richiesta });
                if (cambiaQualcosa(esistente, aggiornamento)) {
                    scrivi(esistente, STATI_APERTI, aggiornamento);
                    esito.aggiornate += 1;
                }
            } else if (esistente.stato === 'annullata' && (suRichiesta || esistente.chiusa_dal_piano)) {
                scrivi(esistente, ['annullata'], setOrUnset({ ...daCapo(piano, consegna), ...richiesta }));
                esito.riaperte += 1;
            } else {
                esito.saltate += 1;
            }
        });

        sue
            .filter((consegna) => STATI_APERTI.includes(consegna.stato))
            .filter((consegna) => !previste.some((voce) => voce.tipo === consegna.tipo))
            .filter((consegna) => !(dalloStorico && consegna.su_richiesta))
            .forEach((consegna) => {
                scrivi(consegna, STATI_APERTI, chiusura(motivoDellaChiusura({ piano, consegna, dalloStorico }), true));
                esito.annullate += 1;
            });
    });

    return esito;
};

module.exports = {
    FATTURA_IN_BOZZA,
    aggiornamentoCoda,
    chiusura,
    indirizzoPostale,
    pianoConsegne,
};
