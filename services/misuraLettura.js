// La misura di una lettura: quanto segna il contatore, quando, di quale
// contatore e in che unita. Una fattura che usa la lettura la fissa - la
// lettura dopo parte da li, e cambiarla vorrebbe dire far pagare due volte un
// consumo o non farlo pagare mai.
const { toDate } = require('../utils/dates');

const CAMPI_DELLA_MISURA = ['consumo', 'data_lettura', 'contatore', 'unita_misura'];

const idDi = (valore) => valore?._id ?? valore;

const stessoValore = (campo, prima, dopo) => {
    if (campo === 'data_lettura') {
        return toDate(prima)?.getTime() === toDate(dopo)?.getTime();
    }
    if (campo === 'consumo') {
        return Number(prima) === Number(dopo);
    }
    return String(idDi(prima) ?? '') === String(idDi(dopo) ?? '');
};

// I campi della misura che una modifica cambierebbe. Un campo che non arriva
// nella richiesta resta com'e, e non conta.
const misuraCambiata = (esistente, corpo) => CAMPI_DELLA_MISURA
    .filter((campo) => Object.hasOwn(corpo, campo) && !stessoValore(campo, esistente[campo], corpo[campo]));

module.exports = {
    CAMPI_DELLA_MISURA,
    misuraCambiata,
};
