import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import type { AtRule, Declaration, Plugin, Rule } from 'postcss'

const apiTarget = process.env.VITE_CONTROL_CENTER_API_TARGET
  || process.env.CONTROL_CENTER_API_TARGET
  || `http://127.0.0.1:${process.env.CONTROL_CENTER_PORT || 4050}`

function cssRuleContext(rule: Rule): string {
  const parts: string[] = []
  let parent = rule.parent
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule') {
      const atRule = parent as AtRule
      parts.unshift(`@${atRule.name} ${atRule.params}`.trim())
    }
    parent = parent.parent
  }
  return parts.join('|')
}

function declarationKey(rule: Rule, declaration: Declaration): string {
  return [
    cssRuleContext(rule),
    rule.selector,
    declaration.prop,
    declaration.important ? 'important' : '',
    declaration.value,
  ].join('\u0000')
}

function dedupeCssDeclarations(): Plugin {
  return {
    postcssPlugin: 'automnia-dedupe-css-declarations',
    Once(root) {
      const rules: Rule[] = []
      root.walkRules((rule) => {
        rules.push(rule)
      })
      const seen = new Set<string>()

      for (let index = rules.length - 1; index >= 0; index -= 1) {
        const rule = rules[index]
        const declarations = rule.nodes?.filter((node): node is Declaration => node.type === 'decl') || []

        for (let declarationIndex = declarations.length - 1; declarationIndex >= 0; declarationIndex -= 1) {
          const declaration = declarations[declarationIndex]
          const key = declarationKey(rule, declaration)
          if (seen.has(key)) {
            declaration.remove()
          } else {
            seen.add(key)
          }
        }

        if (rule.nodes?.every((node) => node.type === 'comment')) {
          rule.remove()
        }
      }
    },
  }
}

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
