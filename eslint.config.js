import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'coverage/**']
    },
    js.configs.recommended,
    prettier,
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2021,
                /** ArcGIS AMD `require([...], callback)` in main.js */
                require: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrors: 'none'
                }
            ],
            'no-console': 'off'
        }
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    },
    {
        files: ['vite.config.js', 'eslint.config.js', 'vitest.config.js'],
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    }
];
