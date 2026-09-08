export function avatarInitials(name: string): string {
  const words = name.normalize('NFC').trim().split(/\s+/u).filter(Boolean)
  if (!words.length) return 'AI'
  const first = Array.from(words[0])
  return (words.length === 1 ? first.slice(0, 2).join('') : `${first[0]}${Array.from(words.at(-1)!)[0]}`).toLocaleUpperCase()
}
