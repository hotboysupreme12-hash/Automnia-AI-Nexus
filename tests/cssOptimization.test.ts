import assert from 'node:assert/strict'
import test from 'node:test'
import postcss from 'postcss'
import { dedupeCssDeclarations } from '../scripts/cssOptimization'

const optimize = (css: string) => postcss([dedupeCssDeclarations()]).process(css, { from: undefined }).css

test('removes an earlier property only when every selector has a guaranteed override', () => {
  assert.equal(optimize('.a,.b{display:block}.a{display:flex}.b{display:grid}'), '.a{display:flex}.b{display:grid}')
  assert.equal(optimize('.a,.b{display:block}.a{display:flex}'), '.a,.b{display:block}.a{display:flex}')
})

test('preserves cross-rule unsupported syntax and same-rule compatibility fallbacks', () => {
  const input = '.a{display:block;display:flex}.a{display:future-layout}.b{color:red}.b{color:color(display-p3 1 0 0)}.c{padding:8px}.c{padding:env(future-inset)}'
  assert.equal(optimize(input), input)
})

test('preserves important declarations, conditional scope, keyframes, and anonymous layers', () => {
  const input = '.a{display:block!important}.a{display:flex}@media (max-width:600px){.a{display:grid}}@layer{.b{display:block}}@layer{.b{display:flex}}@keyframes one{from{opacity:0}to{opacity:1}}@keyframes two{from{opacity:1}to{opacity:0}}'
  assert.equal(optimize(input), input)
})

test('retains custom-property declarations and removes exact repeated values safely', () => {
  const input = '.a{--x:red;color:var(--x)}.a{--x:blue;color:var(--x)}'
  assert.equal(optimize(input), '.a{--x:red}.a{--x:blue;color:var(--x)}')
})

test('does not prune a working fallback behind a selector with unsupported semantics', () => {
  const input = '.a{display:block}.a,:future-selector{display:flex}'
  assert.equal(optimize(input), input)
})
