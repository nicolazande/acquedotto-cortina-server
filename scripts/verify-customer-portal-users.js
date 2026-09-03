// Verifica il ciclo di vita di un account del portale clienti: creazione,
// password troppo corta rifiutata, modifica, disattivazione e riattivazione.
//
// E un test, non un rapporto: lavora su un cliente finto che crea e cancella, e
// fallisce se qualcosa non torna. Lo stato degli account veri lo racconta
// `report:integrita`, che segnala anche gli accessi rimasti senza cliente.
const { runScript } = require('./utils/runScript');
const { callController, withSilencedErrors } = require('./utils/callController');
const assert = require('assert');
const Cliente = require('../models/Cliente');
const User = require('../models/User');
const ClienteController = require('../controllers/ClienteController');

const main = async () => {

    const suffix = Date.now();
    const cliente = await Cliente.create({
        cognome: 'Portal',
        nome: `Verify ${suffix}`,
        codice_cliente_erp: `PV-${suffix}`,
        email: `portal.verify.${suffix}@example.test`,
    });

    try {
        const empty = await callController(ClienteController.getPortalUser, { params: { id: cliente._id } });
        assert.strictEqual(empty.status, 200);
        assert.strictEqual(empty.body, null);

        const invalid = await withSilencedErrors(() => callController(ClienteController.createPortalUser, {
            body: { password: 'short', username: `portal.verify.${suffix}` },
            params: { id: cliente._id },
        }));
        assert.strictEqual(invalid.status, 400);

        const created = await callController(ClienteController.createPortalUser, {
            body: {
                email: cliente.email,
                password: 'TempPass123',
                username: `portal.verify.${suffix}`,
            },
            params: { id: cliente._id },
        });
        assert.strictEqual(created.status, 201);
        assert.strictEqual(created.body.active, true);
        assert.strictEqual(created.body.role, 'cliente');

        let user = await User.findById(created.body.id);
        assert(user, 'portal user was not saved');
        assert(await user.comparePassword('TempPass123'), 'temporary password was not saved correctly');

        const updated = await callController(ClienteController.updatePortalUser, {
            body: {
                active: false,
                email: '',
                password: 'NextPass123',
                username: `portal.updated.${suffix}`,
            },
            params: { id: cliente._id },
        });
        assert.strictEqual(updated.status, 200);
        assert.strictEqual(updated.body.active, false);
        assert.strictEqual(updated.body.email, '');
        assert.strictEqual(updated.body.username, `portal.updated.${suffix}`);

        user = await User.findById(created.body.id);
        assert.strictEqual(user.active, false);
        assert.strictEqual(user.email, undefined);
        assert(await user.comparePassword('NextPass123'), 'reset password was not saved correctly');

        const reactivated = await callController(ClienteController.updatePortalUser, {
            body: { active: true },
            params: { id: cliente._id },
        });
        assert.strictEqual(reactivated.status, 200);
        assert.strictEqual(reactivated.body.active, true);

        console.log('Verifica account portale cliente completata.');
    } finally {
        await User.deleteMany({ role: 'cliente', cliente: cliente._id });
        await Cliente.deleteOne({ _id: cliente._id });
    }
};

runScript(main);
