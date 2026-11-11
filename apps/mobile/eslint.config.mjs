import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Minimal on purpose: the two hook rules and unhandled promises (the sync layer is full of them). Types come from tsc.
export default tseslint.config(
  { ignores: ['android/**', 'ios/**', '.expo/**', 'node_modules/**', 'db/migrations/**', '**/*.js', 'modules/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    },
  },
);
