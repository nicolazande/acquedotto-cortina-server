// L'elenco dei consumi che una volta l'anno va al BIM, che sulla base di quello
// fattura fognatura e depurazione.
//
// Qui ci sono i dati: quali colonne ha l'elenco e da dove viene ogni valore.
// L'impaginazione nei tre formati - Excel per rielaborarlo, PDF per
// archiviarlo, Word per allegarlo a una lettera - la fa `tabellaStampabile`, che
// non sa cosa sta stampando. Le righe si preparano una volta sola e i tre
// formati le impaginano, cosi non puo succedere che il PDF dica una cosa e il
// foglio di calcolo un'altra.

const Lettura = require('../models/Lettura');
// Serviti dalla popolate qui sotto: chiesti per nome, vanno registrati, e
// non si puo contare sul fatto che a caricarli sia stato qualcun altro.
const Contatore = require('../models/Contatore');
require('../models/Cliente');
require('../models/Edificio');
const { dataReale, formatItalianDate, toDate } = require('../utils/dates');
const { customerLabel } = require('../utils/customer');

// Le larghezze sono pesi, non punti: `creaPdf` li scala sulla pagina.
//
// Sono misurate, non stimate a occhio: per ognuna si e preso quanto occupa
// davvero il testo che ci finisce dentro nell'archivio di oggi (il 95 per cento
// piu corto), piu lo spazio ai lati, e lo spazio avanzato e andato alle due
// colonne che troncavano ancora. I titoli sono corti apposta: su una colonna di
// numeri "Lett. att." dice quanto "Lettura Attuale" e lascia la larghezza al
// dato invece che all'intestazione.
const COLONNE = [
    { titolo: 'Codice', campo: 'codiceUtente', larghezza: 33 },
    { titolo: 'Denominazione', campo: 'denominazione', larghezza: 166 },
    { titolo: 'Cod. fiscale', campo: 'codiceFiscale', larghezza: 79 },
    { titolo: 'Partita IVA', campo: 'partitaIva', larghezza: 50 },
    { titolo: 'Seriale', campo: 'seriale', larghezza: 65 },
    { titolo: 'Indirizzo', campo: 'indirizzo', larghezza: 84 },
    { titolo: 'Lett. att.', campo: 'letturaAttuale', larghezza: 36, numero: true },
    { titolo: 'Lett. prec.', campo: 'letturaPrecedente', larghezza: 39, numero: true },
    { titolo: 'Quota', campo: 'percentuale', larghezza: 28, numero: true },
    { titolo: 'Data', campo: 'dataLettura', larghezza: 43 },
    { titolo: 'Consumi', campo: 'consumi', larghezza: 36, numero: true },
    { titolo: 'Tipo fornitura', campo: 'tipoFornitura', larghezza: 135 },
];

const testo = (valore) => (valore === null || valore === undefined ? '' : String(valore));


// Da una lettura alla riga dell'elenco. La quota di riparto conta: su un
// contatore condominiale il consumo che il BIM fattura a ciascuno e la sua
// parte, non il totale del contatore.
const rigaDaLettura = ({ lettura, contatore, cliente, edificio, letturaPrecedente }) => {
    const attuale = Number(lettura?.consumo ?? 0);
    const precedente = Number(letturaPrecedente?.consumo ?? 0);
    const quota = contatore?.consumo ? Number(contatore.consumo) : 100;

    return {
        codiceUtente: testo(cliente?.codice_cliente_erp),
        denominazione: customerLabel(cliente),
        codiceFiscale: testo(cliente?.codice_fiscale),
        partitaIva: testo(cliente?.partita_iva),
        seriale: testo(contatore?.seriale),
        indirizzo: testo(edificio?.indirizzo || contatore?.nome_edificio),
        letturaAttuale: attuale,
        letturaPrecedente: precedente,
        percentuale: quota,
        dataLettura: formatItalianDate(lettura?.data_lettura),
        consumi: Math.max(0, attuale - precedente),
        tipoFornitura: testo(contatore?.tipo_attivita),
        // La data cosi com'e, per ordinare e confrontare: `dataLettura` e gia
        // scritta in giorno/mese/anno e come testo si ordina sbagliata.
        data: toDate(lettura?.data_lettura),
        // Un contatore senza scadenza, o con la data-sentinella del gestionale
        // precedente, e ancora in servizio. Serve a distinguere un subentro -
        // dove uno dei due e cessato - da un condominiale, dove sono attivi
        // entrambi e il consumo andrebbe ripartito.
        inServizio: !dataReale(contatore?.scadenza),
    };
};

// Un .xlsx e un archivio zip di file XML: sono quattro, il minimo che Excel,
// LibreOffice e Fogli Google accettano. Scriverli a mano evita una dipendenza da
// qualche megabyte per produrre una tabella, come si e gia fatto per il PDF
// delle fatture e per l'archivio delle fatture elettroniche.
// Le righe dell'anno, prese in blocco. Una lettura alla volta vorrebbe dire una
// query per la precedente per ognuna delle circa mille letture: qui sono tre
// query in tutto, e la precedente si trova scorrendo le letture ordinate.
//
// La precedente si cerca sul contatore FISICO, cioe sul seriale, non sul record.
// Quando un'utenza cambia intestatario nasce un contatore nuovo che continua a
// leggere lo stesso apparecchio: cercandola sul record, la prima lettura del
// subentrante non ne troverebbe nessuna e partirebbe da zero, addebitandogli
// come consumo dell'anno tutto lo storico dell'apparecchio. Sull'archivio di
// oggi sono 125 seriali con piu intestatari, e sul solo 2025 farebbero 76.987
// mc inesistenti.
// Fra due letture dello stesso giorno viene prima quella del contatore che
// cessa: e la sua, il subentrante parte da li. Un contatore ancora in servizio
// non ha scadenza, o ha la data-sentinella del gestionale precedente, e in
// entrambi i casi va per ultimo.
const ordinaPerSubentro = (letture) => {
    // Una scadenza assente e la data-sentinella del gestionale precedente
    // dicono la stessa cosa - "ancora in servizio" - e devono pesare uguale,
    // altrimenti l'ordine dipenderebbe da come e stato importato il record.
    const fine = (lettura) => (
        dataReale(lettura.contatore?.scadenza)?.getTime() ?? Number.MAX_SAFE_INTEGER
    );

    letture.sort((a, b) => {
        const giorno = toDate(a.data_lettura)?.getTime() - toDate(b.data_lettura)?.getTime();
        return giorno || fine(a) - fine(b);
    });
};

const chiaveApparecchio = (contatore) => (
    contatore?.seriale ? `seriale:${contatore.seriale}` : `contatore:${contatore?._id}`
);

// L'abbinamento fra ogni lettura e quella che la precede sullo stesso
// apparecchio. Sta a parte dalle query perche e la parte che puo sbagliare, ed
// e l'unica che vale la pena verificare riga per riga.
const abbinaLettureAllePrecedenti = ({ letture, anteriori, apparecchioDelContatore }) => {
    const ultimaPrecedente = new Map();

    anteriori.forEach((l) => {
        const chiave = apparecchioDelContatore.get(String(l.contatore));
        if (chiave) ultimaPrecedente.set(chiave, l);
    });

    return letture.map((lettura) => {
        const contatore = lettura.contatore || {};
        const chiave = chiaveApparecchio(contatore);
        const letturaPrecedente = ultimaPrecedente.get(chiave);
        ultimaPrecedente.set(chiave, lettura);

        return rigaDaLettura({
            lettura,
            letturaPrecedente,
            contatore,
            cliente: contatore.cliente,
            edificio: contatore.edificio,
        });
    });
};

const righeDellAnno = async (anno) => {
    const inizio = new Date(Date.UTC(anno, 0, 1));
    const dopo = new Date(Date.UTC(anno + 1, 0, 1));

    const letture = await Lettura.find({ data_lettura: { $gte: inizio, $lt: dopo } })
        .populate({ path: 'contatore', populate: ['cliente', 'edificio'] })
        .sort({ data_lettura: 1, _id: 1 })
        .lean();

    // Il giorno del subentro l'apparecchio viene letto due volte con lo stesso
    // indice: una per chi esce e una per chi entra. Con la sola data le due
    // righe sono a pari merito e l'ordine lo decide l'`_id`, che non c'entra
    // niente: capitando prima il subentrante, il consumo del periodo precedente
    // veniva addebitato a lui e l'uscente restava a zero.
    //
    // Prima chi cessa, poi chi resta: la scadenza del contatore lo dice.
    ordinaPerSubentro(letture);

    // Tutti i record che leggono gli stessi apparecchi, non solo quelli con una
    // lettura quest'anno: il predecessore in genere e cessato da un pezzo.
    const seriali = [...new Set(letture.map((l) => l.contatore?.seriale).filter(Boolean))];
    const fratelli = await Contatore.find({ seriale: { $in: seriali } }).select('seriale').lean();

    const anteriori = await Lettura.find({
        contatore: { $in: fratelli.map((c) => c._id) },
        data_lettura: { $lt: inizio },
    }).sort({ data_lettura: 1, _id: 1 }).select('contatore consumo data_lettura').lean();

    return abbinaLettureAllePrecedenti({
        letture,
        anteriori,
        apparecchioDelContatore: new Map(fratelli.map((c) => [String(c._id), `seriale:${c.seriale}`])),
    });
};

// Cosa contiene l'elenco, senza produrlo. Serve a chi lo deve mandare: prima di
// scaricare novecento righe conviene sapere quante sono, di quanti metri cubi
// si parla e se c'e qualcosa che non torna. I numeri escono dalle stesse righe
// del file, cosi l'anteprima non puo dire una cosa e il documento un'altra.
// I conti sulle righe, separati da chi le va a prendere: e la parte che si puo
// sbagliare, e cosi si verifica senza database.
// Gli apparecchi letti da piu intestatari ancora in servizio: sono
// condominiali, e senza le quote di riparto il consumo non e diviso.
const contatoriDaRipartire = (righe) => {
    const perApparecchio = new Map();

    righe.forEach((riga) => {
        if (!riga.seriale) return;
        if (!perApparecchio.has(riga.seriale)) perApparecchio.set(riga.seriale, []);
        perApparecchio.get(riga.seriale).push(riga);
    });

    return [...perApparecchio.values()].filter((gruppo) => {
        const attivi = new Set(gruppo.filter((r) => r.inServizio).map((r) => r.denominazione));
        return attivi.size > 1;
    }).length;
};

const riepilogoDelleRighe = (anno, righe) => {
    // Ordinate come date, non come testo: "01/11" e "31/10" scritte in
    // giorno/mese/anno si ordinano alfabeticamente al contrario del calendario.
    const date = righe.map((riga) => riga.data).filter(Boolean).sort((a, b) => a - b);

    return {
        anno,
        utenze: righe.length,
        consumi: righe.reduce((somma, riga) => somma + riga.consumi, 0),
        // Le tre cose che rendono un elenco da guardare prima di mandarlo.
        senzaCodiceFiscale: righe.filter((riga) => !riga.codiceFiscale && !riga.partitaIva).length,
        senzaConsumo: righe.filter((riga) => riga.consumi === 0).length,
        // Un consumo che riparte da zero e o un contatore nuovo o un subentro
        // che ha perso il predecessore: vale la pena guardarlo prima di mandare.
        primaLettura: righe.filter((riga) => riga.letturaPrecedente === 0 && riga.letturaAttuale > 0).length,
        // Piu intestatari attivi sullo stesso apparecchio: e un condominiale, e
        // il consumo andrebbe ripartito fra loro. Senza le quote finisce tutto
        // sul primo e gli altri risultano a zero - il totale dell'elenco resta
        // giusto, ma il BIM fatturerebbe a una persona sola quello che hanno
        // consumato in cinque.
        daRipartire: contatoriDaRipartire(righe),
        dallaLettura: formatItalianDate(date[0]),
        allaLettura: formatItalianDate(date[date.length - 1]),
    };
};

const riepilogoDellAnno = async (anno) => riepilogoDelleRighe(anno, await righeDellAnno(anno));

module.exports = {
    COLONNE,
    abbinaLettureAllePrecedenti,
    ordinaPerSubentro,
    rigaDaLettura,
    riepilogoDelleRighe,
    riepilogoDellAnno,
    righeDellAnno,
};
