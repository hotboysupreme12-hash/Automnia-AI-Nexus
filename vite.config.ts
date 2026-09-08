import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { dedupeCssDeclarations } from './scripts/cssOptimization'

const apiTarget = process.env.VITE_CONTROL_CENTER_API_TARGET
  || process.env.CONTROL_CENTER_API_TARGET
  || `http://127.0.0.1:${process.env.CONTROL_CENTER_PORT || 4050}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_CONTROL_CENTER_API_TARGET': JSON.stringify(apiTarget),
  },
  css: {
    postcss: {
      plugins: [tailwindcss({ config: './tailwind.config.js' }), autoprefixer(), dedupeCssDeclarations()],
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/.agents/**',
        '**/.cache/**',
        '**/.codex/**',
        '**/.codex-logs/**',
        '**/.dev-logs/**',
        '**/.dirac-symbol-index/**',
        '**/.openclaw/**',
        '**/.runtime/**',
        '**/.tmp/**',
        '**/build/**',
        '**/dist/**',
        '**/dist-server/**',
        '**/memory/**',
        '**/release/**',
        '**/reports/**',
        '**/runtime-behavior-probe/**',
        '**/tmp/**',
        '**/ui-ux-pro-max/**',
        '**/vendor/**',
        '**/*.log',
        '**/*.err.log',
        '**/*.out.log',
      ],
    },
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
