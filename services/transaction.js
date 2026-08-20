const mongoose = require('mongoose');

const getTransactionErrorMessage = (error) => [
    error?.message,
    error?.cause?.message,
    error?.errorLabels?.join(' '),
].filter(Boolean).join(' ');

// MongoDB standalone (lo scenario di sviluppo locale) non supporta le transazioni:
// in quel caso la stessa operazione viene rieseguita senza sessione.
const isTransactionUnsupported = (error) => /Transaction numbers are only allowed|replica set member|transactions?.*not supported/i
    .test(getTransactionErrorMessage(error));

const runWithOptionalTransaction = async (operation) => {
    const session = await mongoose.startSession();

    try {
        try {
            let result;
            await session.withTransaction(async () => {
                result = await operation(session);
            });
            return result;
        } catch (error) {
            if (!isTransactionUnsupported(error)) {
                throw error;
            }
            return operation(null);
        }
    } finally {
        await session.endSession();
    }
};

module.exports = {
    runWithOptionalTransaction,
};
