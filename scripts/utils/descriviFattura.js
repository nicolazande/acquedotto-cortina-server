// Come una fattura viene identificata nei rapporti: sempre gli stessi cinque
// campi, perche chi legge l'esito deve poterla ritrovare nel gestionale.
// Erano ricopiati in due script, e due elenchi che identificano lo stesso
// documento in modo diverso si confrontano male.
const descriviFattura = (verification) => ({
    fattura: verification.fattura._id,
    anno: verification.fattura.anno,
    numero: verification.fattura.numero,
    codice: verification.fattura.codice,
    cliente: verification.fattura.ragione_sociale || verification.fattura.nome_cliente,
});

module.exports = { descriviFattura };
