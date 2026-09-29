// Gli argomenti dei rapporti: `--limit 100`, `--year 2025`, `--verbose`,
// `--strict`. Scritti una volta invece che in ogni script, cosi si leggono tutti
// allo stesso modo.
const { parseBoolean } = require('../../utils/values');

// Il numero che segue `--nome`, oppure `predefinito` se l'argomento manca.
const numero = (nome, predefinito = null) => {
    const indice = process.argv.indexOf(`--${nome}`);
    return indice === -1 ? predefinito : Number(process.argv[indice + 1]);
};

// Un interruttore: `--nome` sulla riga di comando, o la variabile d'ambiente
// indicata messa a vero.
const acceso = (nome, variabile) => (
    process.argv.includes(`--${nome}`) || (variabile ? parseBoolean(process.env[variabile]) : false)
);

const percentuale = (valore, totale) => (totale ? `${((valore / totale) * 100).toFixed(1)}%` : '0.0%');

module.exports = {
    acceso,
    numero,
    percentuale,
};
