// Il guardiano dei legami fra documenti.
//
// MongoDB non impedisce di cancellare un cliente che ha fatture: le fatture
// restano a puntare al nulla e nessuno se ne accorge finche qualcuno non apre
// quella scheda. Qui si applica cio che config/relations.js dichiara, prima che
// la cancellazione avvenga.
//
// La regola predefinita e rifiutare, non cancellare a catena. In un archivio
// contabile una cancellazione silenziosa che si propaga e molto peggio di un
// messaggio che dice "questo cliente ha 12 fatture": il secondo si legge e si
// decide, la prima si scopre mesi dopo.

const mongoose = require('mongoose');
// I modelli si risolvono per nome, quindi devono essere tutti registrati: chi
// usa questo servizio non deve doversi ricordare quali importare.
require('../models/Articolo');
require('../models/AuditLog');
require('../models/Cliente');
require('../models/Consegna');
require('../models/Contatore');
require('../models/Edificio');
require('../models/Fascia');
require('../models/Fattura');
require('../models/Lettura');
require('../models/Listino');
require('../models/Scadenza');
require('../models/Servizio');
require('../models/User');
const { TUTTI_I_LEGAMI, dipendenzeDi } = require('../config/relations');
const { conflict } = require('../utils/errors');

const modello = (nome) => mongoose.model(nome);

// Il filtro che trova i documenti collegati. Un campo array si interroga allo
// stesso modo di un riferimento singolo.
const filtroCollegati = (campo, id) => ({ [campo]: id });

// Cosa impedisce la cancellazione, con i numeri.
const legamiCheBloccano = async (nome, id) => {
    const bloccanti = [];

    for (const arco of dipendenzeDi(nome).filter((voce) => voce.politica === 'blocca')) {
        const quanti = await modello(arco.modello).countDocuments(filtroCollegati(arco.campo, id));

        if (quanti > 0) {
            bloccanti.push({ ...arco, quanti });
        }
    }

    return bloccanti;
};

const elencoLeggibile = (bloccanti) => bloccanti
    .map((voce) => `${voce.quanti} ${voce.descrizione}`)
    .join(', ');

// Solleva un errore 409 se il documento e ancora collegato a qualcosa.
const assertCancellabile = async (nome, id, etichetta) => {
    const bloccanti = await legamiCheBloccano(nome, id);

    if (bloccanti.length === 0) {
        return;
    }

    throw conflict(
        `${etichetta || nome} non può essere eliminato: ha ancora ${elencoLeggibile(bloccanti)}. `
        + 'Vanno prima spostati o eliminati.'
    );
};

// I documenti che se ne vanno insieme al padre, perche senza di lui non
// significano niente. Restituisce cosa ha cancellato, per il giornale.
const cancellaACascata = async (nome, id) => {
    const cancellati = {};

    for (const arco of dipendenzeDi(nome).filter((voce) => voce.politica === 'cascata')) {
        const esito = await modello(arco.modello).deleteMany(filtroCollegati(arco.campo, id));

        if (esito.deletedCount > 0) {
            cancellati[arco.modello] = esito.deletedCount;
        }
    }

    return cancellati;
};

// Riferimenti che puntano a documenti inesistenti. Non dovrebbero esistere - e
// il motivo per cui la cancellazione e sorvegliata - ma un import, un
// ripristino da backup o una modifica fatta a mano sul database possono
// lasciarne: il rapporto di integrita percorre gli stessi legami dichiarati,
// invece di riscriverli uno per uno.
const riferimentiRotti = async () => {
    const rotti = [];

    // I legami "conserva" possono avere il riferimento appeso per costruzione:
    // segnalarli vorrebbe dire riportare come difetto una scelta voluta.
    for (const arco of TUTTI_I_LEGAMI.filter((voce) => voce.politica !== 'conserva')) {
        const esistenti = new Set(
            (await modello(arco.bersaglio).find({}).select('_id').lean()).map((doc) => String(doc._id))
        );
        const conRiferimento = await modello(arco.modello)
            .find({ [arco.campo]: { $nin: [null, undefined] } })
            .select(arco.campo)
            .lean();

        const quanti = conRiferimento.filter((doc) => {
            const valore = doc[arco.campo];
            const riferimenti = Array.isArray(valore) ? valore : [valore];
            return riferimenti.some((riferimento) => riferimento && !esistenti.has(String(riferimento)));
        }).length;

        if (quanti > 0) {
            rotti.push({ ...arco, quanti });
        }
    }

    return rotti;
};

module.exports = {
    assertCancellabile,
    cancellaACascata,
    riferimentiRotti,
};
