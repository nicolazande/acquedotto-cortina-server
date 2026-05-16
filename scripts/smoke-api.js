const DEFAULT_API_URL = 'http://localhost:5000/api';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.SMOKE_TIMEOUT_MS || '12000', 10);
const TEST_ATTACHMENTS = [
    {
        contentType: 'image/png',
        data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        filename: 'smoke-test.png',
    },
    {
        contentType: 'application/pdf',
        data: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDAvS2lkc1tdPj4KZW5kb2JqCnRyYWlsZXIKPDwvUm9vdCAxIDAgUj4+CiUlRU9G',
        filename: 'smoke-test.pdf',
    },
];
const { RESOURCE_NAMES } = require('../config/resources');

const normalizeApiUrl = (value) => {
    const baseUrl = (value || DEFAULT_API_URL).replace(/\/+$/, '');
    return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
};

const apiUrl = normalizeApiUrl(process.env.SMOKE_API_URL || process.env.API_URL);
const skipMutation = ['1', 'true', 'yes'].includes(String(process.env.SMOKE_SKIP_MUTATION).toLowerCase());

const request = async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(`${apiUrl}${path}`, {
            ...options,
            signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') || '';
        const body = contentType.includes('application/json')
            ? await response.json()
            : await response.arrayBuffer();

        if (!response.ok) {
            throw new Error(`${options.method || 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
        }

        return { body, contentType, response };
    } finally {
        clearTimeout(timeout);
    }
};

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const step = async (label, action) => {
    process.stdout.write(`- ${label}... `);
    await action();
    console.log('ok');
};

const testHealth = async () => {
    const { body } = await request('/auth/health');
    assert(body.status === 'ok', 'health status is not ok');
    assert(body.database === 'connected', 'database is not connected');
};

const testResourceLists = async () => {
    for (const resource of RESOURCE_NAMES) {
        const { body } = await request(`/${resource}?page=1&limit=1`);
        assert(Array.isArray(body.data), `${resource} did not return a paginated data array`);
        assert(Number.isInteger(body.totalItems), `${resource} did not return totalItems`);
    }

    const billingPreview = await request('/fatture/generazione/anteprima?limit=1');
    assert(Array.isArray(billingPreview.body.clienti), 'billing generation preview did not return clienti array');
};

const firstRecord = async (resource, sortField = '') => {
    const query = sortField ? `&sortField=${sortField}` : '';
    const { body } = await request(`/${resource}?page=1&limit=1${query}`);
    const record = body.data && body.data[0];

    assert(record && record._id, `no ${resource} available for relation smoke test`);
    return record;
};

const createRecord = async (resource, payload) => {
    const { body } = await request(`/${resource}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    assert(body && body._id, `${resource} create did not return _id`);
    return body;
};

const deleteCreatedRecords = async (records) => {
    for (const { resource, id } of [...records].reverse()) {
        await request(`/${resource}/${id}`, { method: 'DELETE' });
    }
};

const createTrackedRecord = async (createdRecords, resource, payload) => {
    const record = await createRecord(resource, payload);
    createdRecords.push({ resource, id: record._id });
    return record;
};

const testRelationReferences = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const createdRecords = [];

    try {
        const cliente = await firstRecord('clienti', 'cognome');
        const edificio = await firstRecord('edifici', 'descrizione');
        const listino = await firstRecord('listini', 'categoria');
        const articolo = await firstRecord('articoli', 'codice');
        const fattura = await firstRecord('fatture', 'data_fattura');

        const contatore = await createTrackedRecord(createdRecords, 'contatori', {
            codice: 'SMOKE-REL',
            seriale: 'SMOKE-REL',
            nome_cliente: 'Smoke relazione',
            nome_edificio: 'Smoke edificio',
            cliente: cliente._id,
            edificio: edificio._id,
            listino: listino._id,
        });

        const { body: loadedContatore } = await request(`/contatori/${contatore._id}`);
        assert(loadedContatore.cliente?._id === cliente._id, 'contatore cliente reference was not populated');
        assert(loadedContatore.edificio?._id === edificio._id, 'contatore edificio reference was not populated');
        assert(loadedContatore.listino?._id === listino._id, 'contatore listino reference was not populated');

        const lettura = await createTrackedRecord(createdRecords, 'letture', {
            data_lettura: '2026-05-16',
            consumo: 123,
            unita_misura: 'm3',
            contatore: contatore._id,
        });

        const { body: loadedLettura } = await request(`/letture/${lettura._id}`);
        assert(loadedLettura.contatore?._id === contatore._id, 'lettura contatore reference was not populated');

        const fascia = await createTrackedRecord(createdRecords, 'fasce', {
            tipo: 'SMOKE RELAZIONE',
            min: 0,
            max: 1,
            prezzo: 1,
            inizio: '2026-01-01',
            scadenza: '2026-12-31',
            listino: listino._id,
        });

        const { body: loadedFascia } = await request(`/fasce/${fascia._id}`);
        assert(loadedFascia.listino?._id === listino._id, 'fascia listino reference was not populated');

        const servizio = await createTrackedRecord(createdRecords, 'servizi', {
            descrizione: 'SMOKE RELAZIONE',
            fattura: fattura._id,
            lettura: lettura._id,
            articolo: articolo._id,
            prezzo: 1,
            valore_unitario: 1,
        });

        const { body: loadedServizio } = await request(`/servizi/${servizio._id}`);
        assert(loadedServizio.fattura?._id === fattura._id, 'servizio fattura reference was not populated');
        assert(loadedServizio.lettura?._id === lettura._id, 'servizio lettura reference was not populated');
        assert(loadedServizio.articolo?._id === articolo._id, 'servizio articolo reference was not populated');
    } finally {
        await deleteCreatedRecords(createdRecords);
    }
};

const getAttachmentTarget = async () => {
    const record = await firstRecord('clienti');
    return record._id;
};

const testAttachments = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const clienteId = await getAttachmentTarget();
    const createdIds = [];

    try {
        for (const attachment of TEST_ATTACHMENTS) {
            const createResult = await request(`/attachments/clienti/${clienteId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(attachment),
            });

            const createdId = createResult.body._id;
            createdIds.push(createdId);
            assert(createdId, 'attachment create did not return _id');
            assert(createResult.body.contentType === attachment.contentType, 'attachment content type was not preserved');

            const fileResult = await request(`/attachments/${createdId}/file`);
            assert(fileResult.contentType.startsWith(attachment.contentType), 'attachment file content type is wrong');
            assert(fileResult.body.byteLength > 0, 'attachment file is empty');
        }

        const listResult = await request(`/attachments/clienti/${clienteId}`);
        for (const createdId of createdIds) {
            assert(
                listResult.body.some((attachment) => attachment._id === createdId),
                'created attachment was not listed'
            );
        }
    } finally {
        for (const createdId of createdIds) {
            await request(`/attachments/${createdId}`, { method: 'DELETE' });
        }
    }
};

const testBillingGeneration = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const createdRecords = [];

    try {
        const cliente = await createTrackedRecord(createdRecords, 'clienti', {
            nome: 'Smoke',
            cognome: 'Fatturazione',
            ragione_sociale: 'Smoke Fatturazione',
        });
        const listino = await createTrackedRecord(createdRecords, 'listini', {
            categoria: 'SMOKE FATTURAZIONE',
            descrizione: 'Listino temporaneo smoke test',
        });

        await createTrackedRecord(createdRecords, 'fasce', {
            tipo: 'Tariffa Base',
            min: 1,
            max: 100,
            prezzo: 1,
            inizio: '2026-01-01',
            scadenza: '2026-12-31',
            listino: listino._id,
        });
        await createTrackedRecord(createdRecords, 'fasce', {
            tipo: '1° Supero',
            min: 101,
            max: 999,
            prezzo: 2,
            inizio: '2026-01-01',
            scadenza: '2026-12-31',
            listino: listino._id,
        });
        await createTrackedRecord(createdRecords, 'fasce', {
            tipo: 'Fisso',
            min: 0,
            max: 999,
            prezzo: 10,
            inizio: '2026-01-01',
            scadenza: '2026-12-31',
            listino: listino._id,
        });

        const contatore = await createTrackedRecord(createdRecords, 'contatori', {
            codice: 'SMOKE-BILL',
            seriale: 'SMOKE-BILL',
            nome_cliente: 'Smoke Fatturazione',
            cliente: cliente._id,
            listino: listino._id,
            tipo_attivita: 'SMOKE FATTURAZIONE',
        });
        await createTrackedRecord(createdRecords, 'letture', {
            data_lettura: '2026-01-01',
            consumo: 10,
            unita_misura: 'm3',
            fatturata: true,
            contatore: contatore._id,
        });
        const lettura = await createTrackedRecord(createdRecords, 'letture', {
            data_lettura: '2026-05-16',
            consumo: 135,
            unita_misura: 'm3',
            fatturata: false,
            contatore: contatore._id,
        });

        const preview = await request(`/letture/${lettura._id}/calcolo`);
        assert(preview.body.billableConsumption === 125, 'billing preview did not calculate expected consumption');
        assert(preview.body.totals.imponibile === 160, 'billing preview imponibile is wrong');

        const generated = await request('/fatture/genera-da-letture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ letture: [lettura._id], data_fattura: '2026-05-16' }),
        });
        const fattura = generated.body.fattura;
        const servizi = generated.body.servizi || [];
        assert(fattura?._id, 'generated invoice did not return _id');
        assert(fattura.imponibile === 160, 'generated invoice imponibile is wrong');
        assert(fattura.stato === 'bozza', 'generated invoice should start as bozza');
        assert(fattura.origine === 'letture', 'generated invoice origin should be letture');
        assert((fattura.letture || []).includes(lettura._id), 'generated invoice should keep billed reading ids');
        assert(servizi.length === 3, 'generated invoice should have 3 service rows');
        assert(servizi.every((servizio) => servizio.listino), 'generated services should store listino snapshot reference');
        assert(servizi.every((servizio) => servizio.fascia), 'generated services should store fascia snapshot reference');
        assert(servizi.every((servizio) => servizio.calcolo_snapshot), 'generated services should store calculation snapshot');

        createdRecords.push(...servizi.map((servizio) => ({ resource: 'servizi', id: servizio._id })));
        createdRecords.push({ resource: 'fatture', id: fattura._id });

        const verification = await request(`/fatture/${fattura._id}/verifica-calcolo`);
        assert(verification.body.summary.serviziCoerenti, 'generated invoice services do not match recalculation');
        assert(verification.body.summary.fatturaCoerente, 'generated invoice totals do not match service rows');

        const pdf = await request(`/fatture/${fattura._id}/pdf`);
        assert(pdf.contentType.includes('application/pdf'), 'invoice PDF endpoint did not return application/pdf');
        assert(Buffer.from(pdf.body).subarray(0, 4).toString() === '%PDF', 'invoice PDF body is not a PDF');

        let duplicateBlocked = false;
        try {
            await request('/fatture/genera-da-letture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ letture: [lettura._id], data_fattura: '2026-05-16' }),
            });
        } catch (error) {
            duplicateBlocked = error.message.includes('409');
        }
        assert(duplicateBlocked, 'already billed reading was not blocked');
    } finally {
        await deleteCreatedRecords(createdRecords);
    }
};

const main = async () => {
    console.log(`Smoke API target: ${apiUrl}`);
    await step('health endpoint', testHealth);
    await step('paginated resource lists', testResourceLists);
    await step('relation references create/read/delete', testRelationReferences);
    await step('billing preview/generation/verification', testBillingGeneration);
    await step('note attachments create/list/file/delete', testAttachments);
    console.log('Smoke API completed successfully.');
};

main().catch((error) => {
    const causeMessage = error.cause?.message ? `: ${error.cause.message}` : '';
    console.error(`${error.message}${causeMessage}`);
    process.exit(1);
});
