// Aritmetica monetaria in centesimi interi.
//
// Perche: gli importi in virgola mobile accumulano errori di rappresentazione
// (0.1 + 0.2 non fa 0.3) e l'arrotondamento finisce per dipendere da come il
// numero e stato costruito invece che dal suo valore decimale. Lavorando in
// centesimi interi ogni somma e esatta e l'arrotondamento avviene una volta
// sola, in ingresso, sulla cifra decimale che l'utente ha davvero scritto.
//
// Convenzione: "cents" e sempre un intero; "euro" e un numero con due decimali.

const CENTS_PER_UNIT = 100;
// Un centesimo: sotto questa differenza due importi sono lo stesso importo.
// Serve ovunque si confrontino due totali calcolati per strade diverse, e per
// questo va definita una volta sola - era ripetuta in tre servizi.
const MONEY_TOLERANCE = 0.01;
// Le aliquote sono espresse in punti base (10% = 1000) per restare interi
// anche con aliquote frazionarie come 4,5%.
const BASIS_POINTS_PER_PERCENT = 100;
const BASIS_POINTS_TOTAL = 10000;

const roundHalfUp = (value) => (value >= 0
    ? Math.round(value)
    : -Math.round(-value));

// Scompone la rappresentazione decimale piu breve che rappresenta il numero,
// cioe quella che l'utente vede: per 2.675 si ragiona su "2.675" e non sul suo
// valore binario 2.67499999..., quindi l'arrotondamento e quello atteso.
const decimalToCents = (value) => {
    const testo = String(value);

    if (/e/i.test(testo)) {
        return roundHalfUp(Number(value) * CENTS_PER_UNIT);
    }

    const negativo = testo.startsWith('-');
    const [intero, decimali = ''] = (negativo ? testo.slice(1) : testo).split('.');
    const centesimi = Number(intero) * CENTS_PER_UNIT + Number((decimali + '00').slice(0, 2));
    const resto = decimali.slice(2);
    const arrotonda = resto && Number(`0.${resto}`) >= 0.5 ? 1 : 0;
    const totale = centesimi + arrotonda;

    return negativo ? -totale : totale;
};

// Accetta numeri, stringhe con virgola decimale e valori assenti.
const toCents = (value) => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? decimalToCents(value) : 0;
    }

    const normalizzato = String(value ?? '').replace(',', '.').trim();
    if (normalizzato === '' || !Number.isFinite(Number(normalizzato))) {
        return 0;
    }

    return decimalToCents(normalizzato);
};

const fromCents = (cents) => Math.trunc(cents) / CENTS_PER_UNIT;

const sumCents = (values, getter = (value) => value) => values.reduce(
    (totale, value) => totale + toCents(getter(value)),
    0
);

// Quantita per prezzo unitario: la quantita puo essere frazionaria (metri cubi),
// il risultato torna in centesimi interi.
const multiplyCents = (cents, quantity) => {
    const fattore = Number(quantity);
    if (!Number.isFinite(fattore)) {
        return 0;
    }

    return roundHalfUp(cents * fattore);
};

const rateToBasisPoints = (rate) => roundHalfUp(Number(rate || 0) * BASIS_POINTS_PER_PERCENT);

// Imposta di una singola riga, in centesimi.
const applyRate = (cents, rate) => roundHalfUp((cents * rateToBasisPoints(rate)) / BASIS_POINTS_TOTAL);

// Due importi sono lo stesso importo se differiscono al massimo della
// tolleranza. Si confrontano i centesimi, non i numeri con la virgola.
const stessoImporto = (a, b, tolleranza = MONEY_TOLERANCE) => (
    Math.abs(toCents(a) - toCents(b)) <= toCents(tolleranza)
);

// Un importo come si legge in Italia, per i documenti da stampare: 57.850,43,
// e 9.197,91 - le regole italiane di Intl non separano le migliaia sotto le
// cinque cifre, e lo stesso elenco avrebbe scritto "9197,91" e "13.339,29";
// il client le separa sempre. Si arrotonda in centesimi, non in virgola mobile.
const IMPORTO_ITALIANO = new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: 'always',
});
const importoItaliano = (euro) => IMPORTO_ITALIANO.format(fromCents(toCents(euro)));

module.exports = {
    MONEY_TOLERANCE,
    importoItaliano,
    stessoImporto,
    applyRate,
    fromCents,
    multiplyCents,
    rateToBasisPoints,
    sumCents,
    toCents,
};
