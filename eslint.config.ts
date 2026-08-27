import eslintJsConfigs from '@eslint/js'
import typescriptEslint from 'typescript-eslint'

// Workspace-wide lint config. Packages inherit this; they do not carry their own eslint config.
export default typescriptEslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '.reports/**', '**/*.d.ts'],
  },
  eslintJsConfigs.configs.recommended,
  typescriptEslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
