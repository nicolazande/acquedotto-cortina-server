// L'IBAN, letto per quello che contiene.
//
// In un IBAN italiano l'ABI comincia al quinto carattere e il CAB al decimo:
// ricavarli invece di scriverli in configurazione toglie due valori che
// potrebbero smettere di essere d'accordo con il conto a cui si riferiscono.
const ABI = [5, 10];
const CAB = [10, 15];

const parte = (iban, [inizio, fine]) => String(iban || '').replace(/\s+/g, '').slice(inizio, fine);

const abiDellIban = (iban) => parte(iban, ABI);
const cabDellIban = (iban) => parte(iban, CAB);

// Come si scrive su un documento da leggere: paese e CIN, ABI, CAB e poi il
// conto a gruppi di quattro. Il tracciato elettronico lo vuole invece tutto
// attaccato, che e la forma in cui viene conservato.
const ibanLeggibile = (iban) => {
    const pulito = String(iban || '').replace(/\s+/g, '');
    const gruppi = [pulito.slice(0, 5), pulito.slice(5, 10), pulito.slice(10, 15)];
    const conto = pulito.slice(15).match(/.{1,4}/g) || [];

    return [...gruppi, ...conto].filter(Boolean).join(' ');
};

module.exports = { abiDellIban, cabDellIban, ibanLeggibile };
