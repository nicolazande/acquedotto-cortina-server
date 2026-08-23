// Il trasporto delle email. Un solo punto in cui un messaggio esce davvero.
//
// Il valore predefinito e la MODALITA PROVA: il messaggio viene composto,
// registrato e restituito, ma non consegnato a nessuno. Per farlo partire
// servono due cose insieme, INVIO_EMAIL_ABILITATO=true e un server SMTP
// configurato. E deliberatamente scomodo: una spedizione massiva partita per
// sbaglio non si annulla, e i destinatari sono i clienti dell'acquedotto.
//
// C'e anche una terza rete di sicurezza, INVIO_DESTINATARIO_PROVA: se
// valorizzata, ogni messaggio va a quell'indirizzo invece che al cliente, con
// il destinatario vero scritto nell'oggetto. Serve a provare l'invio completo,
// allegati compresi, senza scrivere a nessuno.

const nodemailer = require('nodemailer');
const { parseBoolean } = require('../utils/values');

const configurazione = () => ({
    abilitato: parseBoolean(process.env.INVIO_EMAIL_ABILITATO),
    host: (process.env.SMTP_HOST || '').trim(),
    porta: Number.parseInt(process.env.SMTP_PORT || '587', 10),
    // La 465 e l'unica porta con TLS implicito: sulle altre si parte in chiaro
    // e si sale con STARTTLS, che e quello che fa nodemailer da solo.
    sicuro: parseBoolean(process.env.SMTP_SECURE) || Number(process.env.SMTP_PORT) === 465,
    utente: (process.env.SMTP_USER || '').trim(),
    password: process.env.SMTP_PASSWORD || '',
    mittente: (process.env.INVIO_MITTENTE || process.env.INVOICE_COMPANY_EMAIL || '').trim(),
    mittenteNome: (process.env.INVIO_MITTENTE_NOME || process.env.INVOICE_COMPANY_NAME || '').trim(),
    rispostaA: (process.env.INVIO_RISPOSTE_A || '').trim(),
    destinatarioProva: (process.env.INVIO_DESTINATARIO_PROVA || '').trim(),
});

// Cosa manca perche una mail possa davvero partire. Un elenco vuoto significa
// che il trasporto e pronto.
const requisitiMancanti = (config = configurazione()) => {
    const mancanti = [];

    if (!config.abilitato) mancanti.push('INVIO_EMAIL_ABILITATO non è attivo');
    if (!config.host) mancanti.push('SMTP_HOST non è configurato');
    if (!config.mittente) mancanti.push('INVIO_MITTENTE non è configurato');

    return mancanti;
};

const mittenteCompleto = (config) => (
    config.mittenteNome ? `"${config.mittenteNome}" <${config.mittente}>` : config.mittente
);

let trasportoInMemoria = null;
let firmaTrasporto = '';

// Il trasporto viene ricostruito solo quando la configurazione cambia: aprire
// una connessione SMTP per ogni messaggio di una spedizione da centinaia di
// fatture significherebbe farsi chiudere la porta in faccia dal server.
const trasporto = (config) => {
    const firma = JSON.stringify([config.host, config.porta, config.sicuro, config.utente]);

    if (!trasportoInMemoria || firma !== firmaTrasporto) {
        trasportoInMemoria = nodemailer.createTransport({
            host: config.host,
            port: config.porta,
            secure: config.sicuro,
            auth: config.utente ? { user: config.utente, pass: config.password } : undefined,
            pool: true,
            maxConnections: Number.parseInt(process.env.SMTP_MAX_CONNECTIONS || '3', 10),
            maxMessages: Number.parseInt(process.env.SMTP_MAX_MESSAGES || '50', 10),
        });
        firmaTrasporto = firma;
    }

    return trasportoInMemoria;
};

// Stato del trasporto per l'interfaccia. Non espone mai la password.
const statoTrasporto = () => {
    const config = configurazione();
    const mancanti = requisitiMancanti(config);

    return {
        abilitato: config.abilitato,
        pronto: mancanti.length === 0,
        mancanti,
        host: config.host || null,
        porta: config.host ? config.porta : null,
        mittente: config.mittente || null,
        destinatarioProva: config.destinatarioProva || null,
    };
};

// Prova la connessione al server senza spedire nulla.
const verificaTrasporto = async () => {
    const config = configurazione();
    const mancanti = requisitiMancanti(config);

    if (mancanti.length) {
        return { ok: false, messaggio: mancanti.join('; ') };
    }

    try {
        await trasporto(config).verify();
        return { ok: true, messaggio: `Connessione a ${config.host} riuscita.` };
    } catch (errore) {
        return { ok: false, messaggio: errore.message };
    }
};

const inviaEmail = async ({ a, oggetto, testo, allegati = [] }) => {
    const config = configurazione();
    const mancanti = requisitiMancanti(config);

    if (!a) {
        throw new Error('Destinatario mancante.');
    }

    if (mancanti.length) {
        // Modalita prova: il messaggio non esce, ma la consegna viene comunque
        // registrata come simulata, cosi il conteggio nell'interfaccia e reale.
        return {
            simulata: true,
            destinatario: a,
            riferimento: null,
            motivo: mancanti.join('; '),
        };
    }

    const deviato = Boolean(config.destinatarioProva);
    const risultato = await trasporto(config).sendMail({
        from: mittenteCompleto(config),
        to: deviato ? config.destinatarioProva : a,
        replyTo: config.rispostaA || undefined,
        subject: deviato ? `[PROVA -> ${a}] ${oggetto}` : oggetto,
        text: testo,
        attachments: allegati.map(({ nome, contenuto, tipo }) => ({
            filename: nome,
            content: contenuto,
            contentType: tipo,
        })),
    });

    return {
        simulata: deviato,
        destinatario: deviato ? config.destinatarioProva : a,
        riferimento: risultato.messageId || null,
        motivo: deviato ? `Deviata su ${config.destinatarioProva}` : null,
    };
};

module.exports = {
    inviaEmail,
    requisitiMancanti,
    statoTrasporto,
    verificaTrasporto,
};
