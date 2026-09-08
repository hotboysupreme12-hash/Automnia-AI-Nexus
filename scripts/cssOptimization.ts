import type { Declaration, Plugin, Rule } from 'postcss'

const length = '(?:0|(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex))'
const lengths = new RegExp(`^${length}(?:\\s+${length}){0,3}$`, 'i')
const sizing = new RegExp(`^(?:auto|${length})$`, 'i')
const colors = /^(?:#[\da-f]{3}(?:[\da-f]{3})?|transparent|currentcolor|black|white|red|green|blue)$/i
const knownPseudos = new Set(['root', 'is', 'where', 'not', 'has', 'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'disabled', 'enabled', 'checked', 'empty', 'first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type', 'only-of-type', 'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type', 'link', 'visited', 'target', 'required', 'optional', 'valid', 'invalid', 'read-only', 'read-write', 'placeholder-shown', 'before', 'after', 'first-letter', 'first-line', 'placeholder', 'selection', 'marker', 'file-selector-button', '-webkit-scrollbar', '-webkit-scrollbar-thumb', '-webkit-scrollbar-track', '-webkit-scrollbar-corner'])
const keywords: Record<string, readonly string[]> = {
  display: ['none', 'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'table', 'contents'],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  visibility: ['visible', 'hidden', 'collapse'],
  overflow: ['visible', 'hidden', 'auto', 'scroll'],
  'overflow-x': ['visible', 'hidden', 'auto', 'scroll'],
  'overflow-y': ['visible', 'hidden', 'auto', 'scroll'],
  'box-sizing': ['border-box', 'content-box'],
  'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'],
  'text-align': ['left', 'right', 'center', 'justify', 'start', 'end'],
  'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
  'pointer-events': ['auto', 'none'],
  'box-shadow': ['none'],
  'text-shadow': ['none'],
  transform: ['none'],
  'background-image': ['none'],
}

/** Deliberately conservative: unknown/new syntax may be a compatibility fallback. */
function guaranteedCoreValue(declaration: Declaration) {
  const { prop } = declaration
  const value = declaration.value.trim().toLowerCase()
  if (keywords[prop]?.includes(value)) return true
  if (/^(?:padding(?:-(?:top|right|bottom|left))?|border-radius|gap|row-gap|column-gap)$/.test(prop)) return lengths.test(value)
  if (/^(?:(?:min-|max-)?(?:width|height)|flex-basis)$/.test(prop)) return sizing.test(value)
  if (/^(?:color|background-color|border(?:-(?:top|right|bottom|left))?-color)$/.test(prop)) return colors.test(value)
  if (prop === 'opacity') return /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)
  if (prop === 'z-index' || prop === 'order') return /^-?\d+$/.test(value)
  if (prop === 'font-weight') return /^(?:normal|bold|[1-9]00)$/.test(value)
  return false
}

export function dedupeCssDeclarations(): Plugin {
  return {
    postcssPlugin: 'automnia-dedupe-css-declarations',
    Once(root) {
      const rules: Rule[] = []
      root.walkRules((rule) => { rules.push(rule) })
      const later = new Map<string, Declaration[]>()
      const anonymousContexts = new WeakMap<object, number>()
      let nextContextId = 0
      for (const rule of rules.toReversed()) {
        // One unsupported selector invalidates an ordinary comma-separated rule.
        // Do not use such a rule as evidence that an earlier declaration loses.
        if (rule.selector.includes('&') || rule.selector.includes('|') || [...rule.selector.matchAll(/:{1,2}([\w-]+)/g)].some((match) => !knownPseudos.has(match[1]))) continue
        const contexts: string[] = []
        let supportedContext = true
        for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
          if (parent.type !== 'atrule' || /keyframes$/i.test(parent.name)) { supportedContext = false; break }
          if (!parent.params) {
            if (!anonymousContexts.has(parent)) anonymousContexts.set(parent, ++nextContextId)
            contexts.unshift(`@${parent.name}#${anonymousContexts.get(parent)}`)
          } else contexts.unshift(`@${parent.name} ${parent.params}`)
        }
        if (!supportedContext) continue
        const selectors = rule.selectors.map((selector) => selector.trim())
        const keys = (prop: string) => selectors.map((selector) => JSON.stringify([contexts, selector, prop]))
        const declarations = rule.nodes.filter((node): node is Declaration => node.type === 'decl')
        for (const declaration of declarations) {
          if (declaration.prop.startsWith('--')) continue
          const unreachable = keys(declaration.prop).every((key) => later.get(key)?.some((candidate) =>
            (!declaration.important || candidate.important)
            && (candidate.value === declaration.value || guaranteedCoreValue(candidate)),
          ))
          if (unreachable) declaration.remove()
        }
        // Only register after the whole rule: same-rule fallback order is retained.
        for (const declaration of rule.nodes.filter((node): node is Declaration => node.type === 'decl')) {
          for (const key of keys(declaration.prop)) {
            const candidates = later.get(key) || []
            if (!candidates.some((candidate) => candidate.value === declaration.value && Boolean(candidate.important) === Boolean(declaration.important))) candidates.push(declaration)
            later.set(key, candidates)
          }
        }
        if (rule.nodes.every((node) => node.type === 'comment')) rule.remove()
      }
    },
  }
}
