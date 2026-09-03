const DEFAULT_TOKEN_TTL = '8h';
const SEGRETO_DI_RIPIEGO = 'solo-per-lo-sviluppo-locale';

// Valori che compaiono negli esempi e nei tutorial: se uno di questi arriva in
// produzione, il segreto e pubblico e chiunque puo firmarsi un token da
// amministratore.
const SEGNAPOSTO = new Set([
    'your_jwt_secret',
    'change-me',
    'changeme',
    'secret',
    'jwt_secret',
    'supersecret',
]);

const LUNGHEZZA_CONSIGLIATA = 32;

// Si considera sviluppo solo cio che lo dichiara. Il controllo era scritto al
// contrario - bloccava soltanto quando NODE_ENV valeva esattamente
// "production" - e quindi un deploy che si dimenticava di impostarla partiva in
// silenzio con il segreto di ripiego. Un dubbio sull'ambiente deve chiudere la
// porta, non aprirla.
const inSviluppo = ['development', 'test'].includes(process.env.NODE_ENV);

const segretoConfigurato = process.env.JWT_SECRET;
const JWT_SECRET = segretoConfigurato || SEGRETO_DI_RIPIEGO;

const debole = !segretoConfigurato || SEGNAPOSTO.has(segretoConfigurato);

if (debole && !inSviluppo) {
    throw new Error(
        'JWT_SECRET non configurato, oppure lasciato al valore di esempio.\n'
        + 'Chiunque conosca quel valore potrebbe entrare come amministratore.\n'
        + 'Impostare una stringa casuale lunga nelle variabili d\'ambiente del servizio,\n'
        + 'per esempio con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
        + 'Se invece questo e un ambiente di sviluppo, impostare NODE_ENV=development.'
    );
}

if (debole) {
    console.warn('JWT_SECRET non configurato: uso un segreto di sviluppo. Non usare questo avvio in produzione.');
} else if (segretoConfigurato.length < LUNGHEZZA_CONSIGLIATA) {
    console.warn(
        `JWT_SECRET e lungo ${segretoConfigurato.length} caratteri: `
        + `sotto i ${LUNGHEZZA_CONSIGLIATA} e indovinabile con la forza bruta.`
    );
}

// Durata della sessione: senza refresh token un valore troppo basso costringe
// l'operatore a rifare il login nel mezzo di una fatturazione.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || DEFAULT_TOKEN_TTL;

module.exports = {
    JWT_EXPIRES_IN,
    JWT_SECRET,
};
