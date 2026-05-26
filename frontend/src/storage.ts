const KEY_BOOKMARKS = 'ssh-open:bookmarks'
const KEY_EXPANDED = 'ssh-open:expanded'
const KEY_FRECENCY = 'ssh-open:frecency'

export interface FrecencyRecord {
  count: number
  lastAccess: number
}

export type FrecencyMap = Record<string, FrecencyRecord>

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export function loadBookmarks(): string[] {
  return safeParse(localStorage.getItem(KEY_BOOKMARKS), [] as string[])
}
export function saveBookmarks(bm: string[]) {
  localStorage.setItem(KEY_BOOKMARKS, JSON.stringify(bm))
}

export function loadExpanded(): Set<string> {
  return new Set(safeParse(localStorage.getItem(KEY_EXPANDED), [] as string[]))
}
export function saveExpanded(s: Set<string>) {
  localStorage.setItem(KEY_EXPANDED, JSON.stringify([...s]))
}

export function loadFrecency(): FrecencyMap {
  return safeParse(localStorage.getItem(KEY_FRECENCY), {} as FrecencyMap)
}
export function saveFrecency(f: FrecencyMap) {
  localStorage.setItem(KEY_FRECENCY, JSON.stringify(f))
}

export function bumpFrecency(f: FrecencyMap, path: string): FrecencyMap {
  const prev = f[path] ?? { count: 0, lastAccess: 0 }
  return { ...f, [path]: { count: prev.count + 1, lastAccess: Date.now() } }
}

// zoxide-ish frecency score: recency-weighted count
export function frecencyScore(rec: FrecencyRecord | undefined): number {
  if (!rec) return 0
  const age = Date.now() - rec.lastAccess
  const hour = 3600_000
  const day = 24 * hour
  const week = 7 * day
  if (age < hour) return rec.count * 4
  if (age < day) return rec.count * 2
  if (age < week) return rec.count * 0.5
  return rec.count * 0.25
}
