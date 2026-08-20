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

module.exports = {
    customerLabel,
};
