import tseslint from 'typescript-eslint';

// Like the app's: unhandled promises only (the sync and crypto code is full of them). Types come from tsc.
export default tseslint.config(
  { ignores: ['node_modules/**', '**/*.js'] },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    },
  },
);
