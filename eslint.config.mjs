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
            // ignoreRestSiblings copre il modo idiomatico di escludere una proprieta:
            // const { daTogliere, ...resto } = oggetto;
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_|^next$',
                varsIgnorePattern: '^_',
                ignoreRestSiblings: true,
            }],
            // console.log e usato di proposito negli script di verifica e di avvio.
            'no-console': 'off',
            eqeqeq: ['warn', 'smart'],
            'prefer-const': 'warn',
            'no-var': 'error',
            // Una costante usata prima di essere definita non e un dettaglio di
            // stile: `const x = x(...)` passa il lint, passa i test e va in
            // pezzi in produzione. E gia successo, togliendo un alias che
            // sembrava inutile e serviva a evitare proprio questo.
            'no-use-before-define': ['error', { functions: false, classes: false }],
        },
    },
];
