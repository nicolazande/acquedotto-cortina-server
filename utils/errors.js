// Errori applicativi con status HTTP: i controller leggono error.status
// e lo usano nella risposta al posto del 500 generico.
const createError = (message, status = 400) => Object.assign(new Error(message), { status });

const badRequest = (message) => createError(message, 400);
const unauthorized = (message) => createError(message, 401);
const forbidden = (message) => createError(message, 403);
const notFound = (message) => createError(message, 404);
const conflict = (message) => createError(message, 409);
const unprocessable = (message) => createError(message, 422);

module.exports = {
    badRequest,
    conflict,
    createError,
    forbidden,
    notFound,
    unauthorized,
    unprocessable,
};
