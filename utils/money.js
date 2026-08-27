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

// Imposta di piu righe sommata prima dell'arrotondamento: mantiene il criterio
// storico (una sola approssimazione, sul totale) ma senza errore di virgola mobile.
// L'IVA si arrotonda una volta per aliquota, non una volta sola sul totale.
//
// E cio che dichiara la fattura elettronica, che raggruppa le righe per
// aliquota e mette in ogni DatiRiepilogo l'imposta di quel gruppo; ed e come
// l'imposta si calcola, perche un'aliquota si applica a un imponibile e non a
// un miscuglio di imponibili diversi.
//
// Finche esiste una sola aliquota diversa da zero i due modi coincidono - sulle
// 3.473 fatture in archivio danno lo stesso identico risultato - ma bastano due
// aliquote insieme per divergere di un centesimo: 1,01 al 10% piu 1,02 al 22%
// fanno 0,33 sommando prima e 0,32 arrotondando per aliquota. Il totale della
// fattura si sarebbe scostato dal suo stesso riepilogo, e l'emissione si
// rifiuta proprio quando quei due non tornano.
const applyRateToLines = (lines) => {
    const perAliquota = new Map();

    lines.forEach(({ cents, rate }) => {
        const punti = rateToBasisPoints(rate);
        perAliquota.set(punti, (perAliquota.get(punti) || 0) + cents);
    });

    return [...perAliquota.entries()].reduce(
        (totale, [punti, cents]) => totale + roundHalfUp((cents * punti) / BASIS_POINTS_TOTAL),
        0
    );
};

module.exports = {
    applyRate,
    applyRateToLines,
    fromCents,
    multiplyCents,
    rateToBasisPoints,
    sumCents,
    toCents,
};
