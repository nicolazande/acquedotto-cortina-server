const parseOptionalBoolean = (value) => {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    return ['1', 'true', 'yes', 'si'].includes(String(value).toLowerCase());
};

module.exports = {
    parseOptionalBoolean,
};
