const test = require('node:test');
const assert = require('node:assert/strict');

const { inviaEmail, requisitiMancanti, statoTrasporto } = require('../services/mailer');

// Le variabili d'ambiente toccate dai test, ripristinate dopo ogni prova.
const CHIAVI = ['INVIO_EMAIL_ABILITATO', 'SMTP_HOST', 'INVIO_MITTENTE', 'INVIO_DESTINATARIO_PROVA'];

const conAmbiente = async (valori, prova) => {
    const precedenti = Object.fromEntries(CHIAVI.map((chiave) => [chiave, process.env[chiave]]));
    Object.entries(valori).forEach(([chiave, valore]) => { process.env[chiave] = valore; });

    try {
        await prova();
    } finally {
        CHIAVI.forEach((chiave) => {
            if (precedenti[chiave] === undefined) delete process.env[chiave];
            else process.env[chiave] = precedenti[chiave];
        });
    }
};

test('senza configurazione non parte nulla', async () => {
    await conAmbiente({ INVIO_EMAIL_ABILITATO: '', SMTP_HOST: '', INVIO_MITTENTE: '' }, async () => {
        const stato = statoTrasporto();

        assert.equal(stato.abilitato, false);
        assert.equal(stato.pronto, false);
        assert.ok(stato.mancanti.length >= 1);
    });
});

test('in modalita prova il messaggio viene registrato ma non consegnato', async () => {
    await conAmbiente({ INVIO_EMAIL_ABILITATO: '', SMTP_HOST: '', INVIO_MITTENTE: '' }, async () => {
        const esito = await inviaEmail({ a: 'ada@rossi.it', oggetto: 'Fattura', testo: 'in allegato' });

        assert.equal(esito.simulata, true);
        assert.equal(esito.riferimento, null);
        assert.match(esito.motivo, /INVIO_EMAIL_ABILITATO/);
    });
});

test('il server configurato senza interruttore acceso non basta', async () => {
    // Due condizioni indipendenti: una configurazione lasciata pronta non deve
    // trasformarsi in una spedizione al primo riavvio.
    await conAmbiente({ INVIO_EMAIL_ABILITATO: '', SMTP_HOST: 'smtp.esempio.it', INVIO_MITTENTE: 'a@b.it' }, () => {
        assert.deepEqual(requisitiMancanti(), ["INVIO_EMAIL_ABILITATO non è attivo"]);
    });
});

test('con tutto configurato non manca piu nulla', async () => {
    await conAmbiente({ INVIO_EMAIL_ABILITATO: 'true', SMTP_HOST: 'smtp.esempio.it', INVIO_MITTENTE: 'a@b.it' }, () => {
        const stato = statoTrasporto();

        assert.deepEqual(stato.mancanti, []);
        assert.equal(stato.pronto, true);
        assert.equal(stato.host, 'smtp.esempio.it');
    });
});

test('lo stato del trasporto non espone la password', () => {
    assert.equal(Object.keys(statoTrasporto()).includes('password'), false);
    assert.equal(JSON.stringify(statoTrasporto()).includes('SMTP_PASSWORD'), false);
});

test('un messaggio senza destinatario e un errore, non un invio a vuoto', async () => {
    await assert.rejects(() => inviaEmail({ oggetto: 'Fattura', testo: 'x' }), /Destinatario mancante/);
});
