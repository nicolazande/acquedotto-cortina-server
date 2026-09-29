// Cosa guardare in una lettura prima di fatturarla, confrontandola con la storia
// del suo contatore. Funzioni pure: la storia - tutte le letture del contatore,
// dalla piu vecchia - la legge chi chiama, una volta per tutta l'anteprima.
//
// Nascono dal giro di novembre: fra le letture da fatturare ce n'erano del 2021,
// piu vecchie di altre gia fatturate, e il calcolo le avrebbe messe in fattura
// senza dire niente.

const { daysBetween, formatItalianDate, toDate } = require('../utils/dates');
const { numberOrZero } = require('../utils/values');

// Un consumo e fuori misura se e almeno il triplo dell'abituale e almeno 50 m³
// in piu: la sola proporzione segnalerebbe 3 m³ contro 1, la sola differenza
// ogni albergo.
const VOLTE_L_ABITUALE = 3;
const METRI_CUBI_IN_PIU = 50;
// I periodi piu corti di un mese non dicono un'abitudine: sono letture di
// controllo, sostituzioni, correzioni.
const GIORNI_MINIMI = 30;
const PERIODI_CONSIDERATI = 3;

const quando = (lettura) => toDate(lettura?.data_lettura)?.getTime() ?? null;
const stessa = (a, b) => String(a?._id) === String(b?._id);

// Le letture del contatore prima di questa, dalla piu vecchia.
const letturePrecedentiA = (lettura, storia) => {
    const data = quando(lettura);
    return data === null ? [] : storia.filter((voce) => !stessa(voce, lettura) && quando(voce) !== null && quando(voce) < data);
};

// L'ultima lettura gia fatturata con una data successiva a questa. Se c'e, la
// lettura non si fattura in automatico: il periodo che misura e gia coperto
// dalle fatture successive, o lo ha fatturato il vecchio programma senza
// segnarla.
const fatturataDopo = (lettura, storia) => {
    const data = quando(lettura);
    if (data === null) {
        return null;
    }

    return storia.filter((voce) => voce.fatturata && !stessa(voce, lettura) && quando(voce) > data).at(-1) || null;
};

const mediana = (valori) => {
    const ordinati = [...valori].sort((a, b) => a - b);
    const meta = Math.floor(ordinati.length / 2);
    return ordinati.length % 2 ? ordinati[meta] : (ordinati[meta - 1] + ordinati[meta]) / 2;
};

// Quanto consuma di solito il contatore, in metri cubi al giorno: la mediana
// degli ultimi periodi prima di questa lettura. Un periodo solo puo essere una
// perdita, tre danno l'abitudine.
const ritmoAbituale = (precedenti) => {
    const ritmi = [];

    for (let indice = precedenti.length - 1; indice > 0 && ritmi.length < PERIODI_CONSIDERATI; indice -= 1) {
        const giorni = daysBetween(precedenti[indice - 1].data_lettura, precedenti[indice].data_lettura);
        const consumo = numberOrZero(precedenti[indice].consumo) - numberOrZero(precedenti[indice - 1].consumo);

        if (giorni >= GIORNI_MINIMI && consumo >= 0) {
            ritmi.push(consumo / giorni);
        }
    }

    return ritmi.length ? mediana(ritmi) : null;
};

// Gli avvisi su una lettura che si puo fatturare, ma che una persona deve
// guardare prima. `consumo` e quello che il calcolo ha misurato.
const avvisiDellaLettura = ({ lettura, consumo, storia = [], oggi = new Date() }) => {
    const avvisi = [];
    const data = toDate(lettura?.data_lettura);

    if (data && data.getUTCFullYear() < oggi.getUTCFullYear()) {
        avvisi.push({
            tipo: 'anno_chiuso',
            messaggio: `Lettura del ${formatItalianDate(data)}: è di un anno già chiuso. `
                + 'Controlla che non sia già stata fatturata.',
        });
    }

    const precedenti = letturePrecedentiA(lettura, storia);
    const ritmo = ritmoAbituale(precedenti);
    const ultima = precedenti.at(-1);

    if (ritmo !== null && ultima) {
        const atteso = ritmo * daysBetween(ultima.data_lettura, lettura.data_lettura);
        const misurato = numberOrZero(consumo);

        if (misurato >= atteso * VOLTE_L_ABITUALE && misurato - atteso >= METRI_CUBI_IN_PIU) {
            avvisi.push({
                tipo: 'consumo_alto',
                messaggio: `Consumo di ${Math.round(misurato)} m³, di solito circa ${Math.round(atteso)} m³ `
                    + 'nello stesso periodo: una perdita o una cifra sbagliata?',
            });
        }
    }

    return avvisi;
};

// Perche una lettura piu vecchia di una gia fatturata non entra in fattura.
const motivoLetturaSuperata = (lettura, successiva) => (
    `Lettura del ${formatItalianDate(lettura.data_lettura)}, più vecchia di quella del `
    + `${formatItalianDate(successiva.data_lettura)} già fatturata: non si fattura in automatico. `
    + 'Se l\'aveva fatturata il vecchio programma, segnala come fatturata dalla sua scheda.'
);

module.exports = {
    avvisiDellaLettura,
    fatturataDopo,
    motivoLetturaSuperata,
    ritmoAbituale,
};
