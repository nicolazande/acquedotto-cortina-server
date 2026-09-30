// L'IBAN, letto per quello che contiene.
//
// In un IBAN italiano l'ABI comincia al quinto carattere e il CAB al decimo:
// ricavarli invece di scriverli in configurazione toglie due valori che
// potrebbero smettere di essere d'accordo con il conto a cui si riferiscono.
const ABI = [5, 10];
const CAB = [10, 15];

const compatto = (iban) => String(iban || '').replace(/\s+/g, '').toUpperCase();

// ABI e CAB esistono solo nei conti italiani e sammarinesi: in un IBAN estero
// in quelle posizioni c'e altro, e il tracciato scarterebbe la fattura.
const parte = (iban, [inizio, fine]) => (/^(IT|SM)/.test(compatto(iban)) ? compatto(iban).slice(inizio, fine) : '');

const abiDellIban = (iban) => parte(iban, ABI);
const cabDellIban = (iban) => parte(iban, CAB);

// Come si scrive su un documento da leggere: paese e CIN, ABI, CAB e poi il
// conto a gruppi di quattro. Il tracciato elettronico lo vuole invece tutto
// attaccato, che e la forma in cui viene conservato.
const ibanLeggibile = (iban) => {
    const pulito = compatto(iban);
    const gruppi = [pulito.slice(0, 5), pulito.slice(5, 10), pulito.slice(10, 15)];
    const conto = pulito.slice(15).match(/.{1,4}/g) || [];

    return [...gruppi, ...conto].filter(Boolean).join(' ');
};

// Se l'IBAN sta in piedi: la forma, la lunghezza italiana e le due cifre di
// controllo (ISO 13616, resto 1 nella divisione per 97). Un IBAN sbagliato non
// si scrive nella fattura elettronica - lo SdI la scarterebbe - e un addebito
// su quel conto la banca lo rifiuta.
const ibanValido = (iban) => {
    const pulito = compatto(iban);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(pulito) || (pulito.startsWith('IT') && pulito.length !== 27)) {
        return false;
    }
    const cifre = `${pulito.slice(4)}${pulito.slice(0, 4)}`.replace(/[A-Z]/g, (lettera) => String(lettera.charCodeAt(0) - 55));
    return [...cifre].reduce((resto, cifra) => (resto * 10 + Number(cifra)) % 97, 0) === 1;
};

// Il conto del cliente su un foglio che viaggia in busta: il paese con il CIN e
// le ultime quattro cifre bastano a riconoscerlo, il resto non serve.
const ibanNascosto = (iban) => {
    const pulito = compatto(iban);
    return pulito.length > 8 ? `${pulito.slice(0, 4)} ${'*'.repeat(pulito.length - 8)} ${pulito.slice(-4)}` : pulito;
};

module.exports = { abiDellIban, cabDellIban, ibanCompatto: compatto, ibanLeggibile, ibanNascosto, ibanValido };
