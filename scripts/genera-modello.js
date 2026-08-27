// Disegna il modello dei dati leggendolo dal codice.
//
// Il diagramma disegnato a mano invecchia in silenzio: quello in
// documents/uml/ era rimasto a una bozza con classi che non esistono piu e
// senza tre collezioni che nel frattempo erano nate. Un disegno che mente e
// peggio di nessun disegno, perche chi arriva dopo si fida.
//
// Qui le classi sono gli schemi Mongoose e le frecce sono i loro `ref`: se
// qualcuno aggiunge un campo, il diagramma se ne accorge da solo. Lo script
// segnala anche i legami che esistono nello schema ma che nessuno ha
// dichiarato in config/relations.js, cioe quelli che alla cancellazione non
// verrebbero ne bloccati ne seguiti: e da li che nascono i documenti orfani.
const fs = require('fs');
const path = require('path');
const { TUTTI_I_LEGAMI } = require('../config/relations');

const CARTELLA_MODELLI = path.join(__dirname, '..', 'models');
const DESTINAZIONE = path.join(__dirname, '..', 'docs', 'modello.md');

const SIMBOLO = { blocca: '..>', cascata: '-->', conserva: '..>' };

const caricaSchemi = () => fs.readdirSync(CARTELLA_MODELLI)
    .filter((file) => file.endsWith('.js'))
    .map((file) => {
        const modello = require(path.join(CARTELLA_MODELLI, file));
        return { nome: modello.modelName, schema: modello.schema };
    })
    .sort((uno, altro) => uno.nome.localeCompare(altro.nome));

// I campi che portano a un'altra collezione, array compresi.
const legamiDelloSchema = (schema) => {
    const trovati = [];
    schema.eachPath((percorso, tipo) => {
        const singolo = tipo.instance === 'ObjectId' ? tipo.options : null;
        const dentroArray = tipo.instance === 'Array' ? tipo.caster?.options : null;
        const opzioni = singolo?.ref ? singolo : (dentroArray?.ref ? dentroArray : null);
        if (opzioni?.ref) {
            trovati.push({ campo: percorso, bersaglio: opzioni.ref, molti: Boolean(dentroArray) });
        }
    });
    return trovati;
};

const campiVisibili = (schema) => {
    const righe = [];
    schema.eachPath((percorso, tipo) => {
        if (percorso === '__v' || percorso.includes('.')) {
            return;
        }
        const tipoBase = tipo.instance === 'Array'
            ? `${tipo.caster?.instance === 'ObjectId' ? 'Ref' : tipo.caster?.instance || 'Mixed'}[]`
            : tipo.instance;
        righe.push(`        ${tipoBase === 'ObjectId' ? 'Ref' : tipoBase} ${percorso}`);
    });
    return righe;
};

const disegna = (schemi) => {
    const dichiarati = new Map(TUTTI_I_LEGAMI.map((arco) => [`${arco.modello}.${arco.campo}`, arco]));
    const righe = ['```mermaid', 'classDiagram'];

    schemi.forEach(({ nome, schema }) => {
        righe.push(`    class ${nome} {`, ...campiVisibili(schema), '    }');
    });

    const nonDichiarati = [];
    schemi.forEach(({ nome, schema }) => {
        legamiDelloSchema(schema).forEach((legame) => {
            const chiave = `${nome}.${legame.campo}`;
            const arco = dichiarati.get(chiave);
            // Un riferimento semplice e molti-a-uno: piu documenti possono
            // puntare allo stesso padre, a meno che un indice unico lo vieti.
            const unico = schema.path(legame.campo)?.options?.unique;
            const daQuesta = legame.molti || !unico ? '*' : '1';
            const freccia = arco ? SIMBOLO[arco.politica] : '..>';
            const etichetta = arco ? arco.politica : 'non dichiarato';
            righe.push(`    ${legame.bersaglio} "1" ${freccia} "${daQuesta}" ${nome} : ${legame.campo} (${etichetta})`);
            if (!arco) {
                nonDichiarati.push(`${chiave} -> ${legame.bersaglio}`);
            }
        });
    });

    righe.push('```');
    return { diagramma: righe.join('\n'), nonDichiarati };
};

const componi = () => {
    const schemi = caricaSchemi();
    const { diagramma, nonDichiarati } = disegna(schemi);
    const documento = `# Il modello dei dati

<!-- Generato da scripts/genera-modello.js. Non si modifica a mano: si cambia
     lo schema in models/ o la politica in config/relations.js e si rilancia
     \`npm run modello\`. -->

Le classi sono gli schemi in [models/](../models), le frecce i loro riferimenti.
L'etichetta dice cosa succede al documento puntato quando si cancella il padre:

- **blocca** — la cancellazione e rifiutata finche esistono documenti collegati
  (freccia tratteggiata);
- **cascata** — i collegati vengono cancellati insieme (freccia piena);
- **conserva** — il collegato resta e il riferimento puo restare appeso, perche
  tiene gia la sua copia di cio che gli serve (il giornale delle modifiche).

Le politiche sono dichiarate in [config/relations.js](../config/relations.js), in
un posto solo, e sono le stesse che usa il rapporto di integrita.

${diagramma}

${nonDichiarati.length === 0
        ? 'Ogni riferimento presente negli schemi ha la sua politica dichiarata.'
        : `**Riferimenti senza politica dichiarata** (alla cancellazione non verrebbero ne bloccati ne seguiti):\n\n${nonDichiarati.map((voce) => `- ${voce}`).join('\n')}`}
`;

    return { documento, schemi, nonDichiarati };
};

// Lanciato a mano scrive il file; importato serve al test che verifica che il
// file su disco sia ancora quello che il codice descrive.
if (require.main === module) {
    const { documento, schemi, nonDichiarati } = componi();
    fs.writeFileSync(DESTINAZIONE, documento);
    console.log(`${schemi.length} collezioni disegnate in docs/modello.md`);
    if (nonDichiarati.length > 0) {
        console.log(`Riferimenti senza politica dichiarata: ${nonDichiarati.length}`);
        nonDichiarati.forEach((voce) => console.log(`  ${voce}`));
    }
}

module.exports = { componi, DESTINAZIONE };
