const cleanNamePart = (value) => {
    const text = String(value ?? '').trim();
    return text && text !== '.' ? text : '';
};

// Etichetta del cliente usata da fatture, PDF, scadenze e portale:
// ragione sociale se presente, altrimenti "cognome nome".
const customerLabel = (cliente, fallbackRecord) => (
    cleanNamePart(cliente?.ragione_sociale)
    || [cleanNamePart(cliente?.cognome), cleanNamePart(cliente?.nome)].filter(Boolean).join(' ')
    || cleanNamePart(fallbackRecord?.ragione_sociale)
    || cleanNamePart(fallbackRecord?.nome_cliente)
    || ''
);

// Di un cliente, chi va a leggere i contatori ha bisogno di sapere chi e e dove
// sta: il nome per bussare, il recapito per trovarlo, il telefono per chiamare
// se non c'e nessuno. Non dell'IBAN, del codice fiscale, della partita IVA ne
// del mandato di addebito.
//
// L'elenco sta qui, accanto alle altre cose che si sanno di un cliente, e non
// nel controller: e una decisione su quali dati una persona puo vedere, e va
// scritta in un posto solo.
const CAMPI_PER_LETTURISTA = [
    '_id',
    'ragione_sociale',
    'cognome',
    'nome',
    'codice_cliente_erp',
    'indirizzo_residenza',
    'numero_residenza',
    'cap_residenza',
    'localita_residenza',
    'provincia_residenza',
    'telefono',
];

const soloCampiPerLetturista = (cliente) => {
    if (!cliente) {
        return cliente;
    }

    const grezzo = typeof cliente.toObject === 'function' ? cliente.toObject() : cliente;
    return Object.fromEntries(CAMPI_PER_LETTURISTA
        .filter((campo) => grezzo[campo] !== undefined)
        .map((campo) => [campo, grezzo[campo]]));
};

// Il CAP italiano ha cinque cifre, e gli zeri davanti contano: l'archivio ne ha
// 33 salvati come numero (Roma "135" per 00135), e il tracciato della fattura
// elettronica un CAP di tre cifre lo scarta. Un valore che non e fatto di sole
// cifre resta com'e.
const capItaliano = (valore) => {
    const cap = String(valore ?? '').trim();
    return /^\d{1,4}$/.test(cap) ? cap.padStart(5, '0') : cap;
};

// Un cliente ha due indirizzi, residenza e fatturazione, e se ne prende sempre
// uno intero: mescolare i campi - la via di uno, il CAP dell'altro - da un
// indirizzo che non esiste. Prima busta, PDF e fattura elettronica avevano tre
// regole diverse, e la busta prendeva ogni campo per conto suo.
const testo = (valore) => String(valore ?? '').trim();

const bloccoIndirizzo = (cliente, quale) => ({
    via: testo(cliente?.[`indirizzo_${quale}`]),
    numero: testo(cliente?.[`numero_${quale}`]),
    cap: capItaliano(cliente?.[`cap_${quale}`]),
    localita: testo(cliente?.[`localita_${quale}`]),
    provincia: testo(cliente?.[`provincia_${quale}`]),
});

// Il primo dei due che ha almeno via e localita; se nessuno ce l'ha, il primo
// che ha qualcosa scritto, perche un indirizzo a meta e meglio di uno vuoto.
const primoCompleto = (cliente, ...quali) => {
    const blocchi = quali.map((quale) => bloccoIndirizzo(cliente, quale));
    return blocchi.find((blocco) => blocco.via && blocco.localita)
        || blocchi.find((blocco) => Object.values(blocco).some(Boolean))
        || blocchi[0];
};

// Dove si spedisce la carta: la fatturazione, altrimenti la residenza.
const indirizzoDiRecapito = (cliente) => primoCompleto(cliente, 'fatturazione', 'residenza');

// Il domicilio fiscale, per la fattura elettronica: la residenza, altrimenti la
// fatturazione. Chi abita a Venezia e riceve la bolletta a Zuel ha Venezia.
const sedeFiscale = (cliente) => primoCompleto(cliente, 'residenza', 'fatturazione');

module.exports = {
    CAMPI_PER_LETTURISTA,
    capItaliano,
    indirizzoDiRecapito,
    sedeFiscale,
    soloCampiPerLetturista,
    customerLabel,
};
