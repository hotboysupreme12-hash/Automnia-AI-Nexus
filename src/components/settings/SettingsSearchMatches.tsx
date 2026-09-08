import { useEffect, useState, type RefObject } from 'react'

export function SettingsSearchMatches({ query, root }: { query: string; root: RefObject<HTMLElement | null> }) {
  const [matches, setMatches] = useState<Array<{ label: string; field: HTMLElement }>>([])
  useEffect(() => {
    let reset = () => {}
    const frame = requestAnimationFrame(() => {
    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    const fields = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-setting-label]') || [])
    const matching = fields.filter((field) => tokens.every((word) => `${field.dataset.settingLabel} ${field.dataset.settingHint || ''}`.toLowerCase().includes(word)))
    fields.forEach((field) => { field.dataset.searchMatch = tokens.length && matching.includes(field) ? 'true' : 'false' })
    const sections = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-search-section-name]') || [])
    sections.forEach((section) => {
      section.dataset.searchSection = !tokens.length || matching.some((field) => section.contains(field)) || tokens.every((word) => `${section.dataset.searchSectionName} ${section.dataset.searchSectionKeywords}`.toLowerCase().includes(word)) ? 'true' : 'false'
    })
    setMatches(tokens.length ? matching.map((field) => ({ label: `${field.dataset.settingLabel || ''} · ${field.closest('[data-search-section-name]')?.querySelector('h3')?.textContent || 'Settings'}`, field })) : [])
    reset = () => { fields.forEach((field) => delete field.dataset.searchMatch); sections.forEach((section) => delete section.dataset.searchSection) }
    })
    return () => { cancelAnimationFrame(frame); reset() }
  }, [query, root])
  if (!query.trim()) return null
  return <div className="my-3 flex flex-wrap gap-2" aria-label="Matching settings">
    {!matches.length && <p className="text-sm text-slate-300">No controls match this phrase. Try “console width”, “contrast”, or “microphone”.</p>}
    {matches.map(({ label, field }, index) => <button type="button" key={`${label}-${index}`} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200" onClick={() => {
      const control = field.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')
      control?.focus({ preventScroll: true })
      field.scrollIntoView({ block: 'center', behavior: 'auto' })
    }}>{label}</button>)}
    <span className="sr-only" role="status">{matches.length} matching settings</span>
  </div>
}
