import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'node_modules/**',
    'dist/**',
    'dist-server/**',
    'release/**',
    'release-*/**',
    'build/**',
    'vendor/**',
    'docs/openclaw-latest/**',
    'rleeae complete/**',
    '.agents/**',
    '.cache/**',
    '.codex/**',
    '.dev-logs/**',
    '.dirac-symbol-index/**',
    '.openclaw/**',
    '.runtime/**',
    'memory/**',
    'reports/**',
    'runtime-behavior-probe/**',
    'tmp/**',
    '.tmp/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
