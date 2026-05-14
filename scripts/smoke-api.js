const DEFAULT_API_URL = 'http://localhost:5000/api';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.SMOKE_TIMEOUT_MS || '12000', 10);
const TEST_IMAGE_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const resources = [
    'articoli',
    'clienti',
    'contatori',
    'edifici',
    'fasce',
    'fatture',
    'letture',
    'listini',
    'scadenze',
    'servizi',
];

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
    for (const resource of resources) {
        const { body } = await request(`/${resource}?page=1&limit=1`);
        assert(Array.isArray(body.data), `${resource} did not return a paginated data array`);
        assert(Number.isInteger(body.totalItems), `${resource} did not return totalItems`);
    }
};

const getAttachmentTarget = async () => {
    const { body } = await request('/clienti?page=1&limit=1');
    const record = body.data && body.data[0];
    assert(record && record._id, 'no cliente available for attachment smoke test');
    return record._id;
};

const testAttachments = async () => {
    if (skipMutation) {
        console.log('skipped');
        return;
    }

    const clienteId = await getAttachmentTarget();
    let createdId;

    try {
        const createResult = await request(`/attachments/clienti/${clienteId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: 'smoke-test.png',
                contentType: 'image/png',
                data: TEST_IMAGE_DATA,
            }),
        });

        createdId = createResult.body._id;
        assert(createdId, 'attachment create did not return _id');

        const listResult = await request(`/attachments/clienti/${clienteId}`);
        assert(
            listResult.body.some((attachment) => attachment._id === createdId),
            'created attachment was not listed'
        );

        const fileResult = await request(`/attachments/${createdId}/file`);
        assert(fileResult.contentType.startsWith('image/'), 'attachment file is not an image');
        assert(fileResult.body.byteLength > 0, 'attachment file is empty');
    } finally {
        if (createdId) {
            await request(`/attachments/${createdId}`, { method: 'DELETE' });
        }
    }
};

const main = async () => {
    console.log(`Smoke API target: ${apiUrl}`);
    await step('health endpoint', testHealth);
    await step('paginated resource lists', testResourceLists);
    await step('note image attachments create/list/file/delete', testAttachments);
    console.log('Smoke API completed successfully.');
};

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
