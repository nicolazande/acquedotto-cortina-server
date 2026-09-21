// Partita IVA e codice fiscale, verificati con il loro carattere di controllo.
//
// Un codice sbagliato di una cifra ha la forma giusta e passa ogni controllo di
// lunghezza, ma la fattura elettronica con quel codice viene scartata dallo SdI.
// Il carattere di controllo e fatto apposta per accorgersene prima.

// Partita IVA: undici cifre, l'ultima e il controllo. Le cifre in posizione pari
// si raddoppiano (togliendo 9 se superano 9), le dispari si sommano cosi come
// sono; il controllo porta la somma al multiplo di dieci.
const partitaIvaValida = (valore) => {
    const codice = String(valore || '').trim();
    if (!/^\d{11}$/.test(codice)) {
        return false;
    }

    const somma = codice.slice(0, 10).split('').reduce((totale, carattere, indice) => {
        const cifra = Number(carattere);
        if (indice % 2 === 0) {
            return totale + cifra;
        }
        const doppio = cifra * 2;
        return totale + (doppio > 9 ? doppio - 9 : doppio);
    }, 0);

    return (10 - (somma % 10)) % 10 === Number(codice[10]);
};

// Codice fiscale di una persona: sedici caratteri, l'ultimo e una lettera di
// controllo. Ogni carattere vale un numero diverso secondo che stia in posizione
// dispari o pari; la somma modulo 26 da la lettera. Le tabelle comprendono anche
// le lettere che sostituiscono le cifre nei codici di omocodia.
const DISPARI = {
    0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
    N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

const valorePari = (carattere) => (/\d/.test(carattere)
    ? Number(carattere)
    : carattere.charCodeAt(0) - 'A'.charCodeAt(0));

const codiceFiscalePersonaValido = (codice) => {
    if (!/^[A-Z]{6}[\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{3}[A-Z]$/.test(codice)) {
        return false;
    }

    const somma = codice.slice(0, 15).split('').reduce((totale, carattere, indice) => (
        totale + (indice % 2 === 0 ? DISPARI[carattere] : valorePari(carattere))
    ), 0);

    return String.fromCharCode('A'.charCodeAt(0) + (somma % 26)) === codice[15];
};

// Il codice fiscale di una societa o di un ente e di undici cifre, con lo stesso
// controllo della partita IVA.
const codiceFiscaleValido = (valore) => {
    const codice = String(valore || '').trim().toUpperCase();
    return codice.length === 11 ? partitaIvaValida(codice) : codiceFiscalePersonaValido(codice);
};

module.exports = { codiceFiscaleValido, partitaIvaValida };
