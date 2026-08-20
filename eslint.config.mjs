import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        // .venv contiene le dipendenze Python degli script di import, che a loro
        // volta includono JavaScript di terze parti: non e codice del progetto.
        ignores: ['node_modules/**', 'backups/**', 'documents/**', '.venv/**', 'assets/**'],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                // Il test runner di Node non espone globali: i test usano require.
            },
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$', varsIgnorePattern: '^_' }],
            // console.log e usato di proposito negli script di verifica e di avvio.
            'no-console': 'off',
            eqeqeq: ['warn', 'smart'],
            'prefer-const': 'warn',
            'no-var': 'error',
        },
    },
];
