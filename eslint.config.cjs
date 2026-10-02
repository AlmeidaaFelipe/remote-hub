const js = require('@eslint/js');
const ts = require('typescript-eslint');
module.exports = [
  { ignores: ['out/**', 'node_modules/**', 'tools/**', 'docs/**', '.vscode-test/**'] },
  { ...js.configs.recommended, files: ['src/**/*.ts', 'tests/**/*.cjs', '*.cjs'], languageOptions: {
    globals: Object.fromEntries(['require','module','exports','process','console','Buffer','setTimeout','clearTimeout','setImmediate','__dirname','URL','global'].map(name => [name, 'readonly'])),
  } },
  { files: ['tests/webview.test.cjs'], languageOptions: { globals: { window: 'readonly', document: 'readonly' } } },
  { files: ['src/**/*.ts'], languageOptions: { parser: ts.parser }, plugins: { '@typescript-eslint': ts.plugin }, rules: {
    ...ts.configs.eslintRecommended.rules,
    'no-unused-vars': 'off', // TypeScript-aware rule below handles parameter properties and types.
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    'no-async-promise-executor': 'error',
    'no-unsafe-finally': 'error',
  } },
];
