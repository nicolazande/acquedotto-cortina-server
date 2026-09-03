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

module.exports = {
    CAMPI_PER_LETTURISTA,
    soloCampiPerLetturista,
    customerLabel,
};
