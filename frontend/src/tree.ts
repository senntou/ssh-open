export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modTime: number
}

export interface FlatNode {
  path: string
  name: string
  isDir: boolean
  size: number
  depth: number
  parentPath: string | null
  rootKind: 'bookmark' | 'current' | null
  expanded: boolean
}

export function parentPath(p: string): string | null {
  if (!p || p === '/') return null
  const i = p.lastIndexOf('/')
  if (i <= 0) return '/'
  return p.slice(0, i)
}

export function basename(p: string): string {
  if (!p || p === '/') return '/'
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

// Compact display for tree-root labels. Shows last 1-2 segments to keep
// the tree readable; the full path is available via title attribute.
export function shortRootLabel(p: string): string {
  if (!p || p === '/') return '/'
  const parts = p.split('/').filter(Boolean)
  if (parts.length <= 2) return '/' + parts.join('/')
  return parts.slice(-2).join('/')
}

export function isUnderOrEqual(child: string, parent: string): boolean {
  if (parent === '/') return child.startsWith('/')
  return child === parent || child.startsWith(parent + '/')
}

// Find the longest bookmark that contains `path`, or null.
export function containingBookmark(path: string, bookmarks: string[]): string | null {
  let best: string | null = null
  for (const b of bookmarks) {
    if (isUnderOrEqual(path, b) && (best === null || b.length > best.length)) {
      best = b
    }
  }
  return best
}

// Ancestor chain from root to path, inclusive of both.
export function ancestorsBetween(root: string, path: string): string[] {
  if (root === path) return [root]
  if (!isUnderOrEqual(path, root)) return [path]
  const out = [root]
  const rel = root === '/' ? path.slice(1) : path.slice(root.length + 1)
  if (!rel) return out
  const parts = rel.split('/')
  let cur = root === '/' ? '' : root
  for (const p of parts) {
    cur = cur + '/' + p
    out.push(cur)
  }
  return out
}

interface FlattenInput {
  bookmarks: string[]
  currentPath: string
  expanded: Set<string>
  children: Record<string, FileEntry[]>
}

// Build the flat list shown in the left tree pane.
//
// Roots, in order:
//   1. each bookmark
//   2. currentPath (if it is not already under any bookmark)
//
// A root is always rendered, even if its dir is not yet loaded.
export function flattenTree({ bookmarks, currentPath, expanded, children }: FlattenInput): FlatNode[] {
  const out: FlatNode[] = []

  const pushSubtree = (path: string, depth: number, parent: string | null, rootKind: FlatNode['rootKind']) => {
    const isExpanded = expanded.has(path)
    out.push({
      path,
      name: depth === 0 ? shortRootLabel(path) : basename(path),
      isDir: true,
      size: 0,
      depth,
      parentPath: parent,
      rootKind,
      expanded: isExpanded,
    })
    if (!isExpanded) return
    const kids = children[path]
    if (!kids) return
    for (const k of kids) {
      if (k.isDir) {
        pushSubtree(k.path, depth + 1, path, null)
      } else {
        out.push({
          path: k.path,
          name: k.name,
          isDir: false,
          size: k.size,
          depth: depth + 1,
          parentPath: path,
          rootKind: null,
          expanded: false,
        })
      }
    }
  }

  for (const bm of bookmarks) {
    pushSubtree(bm, 0, null, 'bookmark')
  }

  if (currentPath && !containingBookmark(currentPath, bookmarks)) {
    pushSubtree(currentPath, 0, null, 'current')
  }

  return out
}

// Subsequence fuzzy match. Returns a score where higher is better, or null
// if `query` is not a subsequence of `text`. Bonuses for matches at
// path-segment starts, and for consecutive runs.
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0
  const lt = text.toLowerCase()
  const lq = query.toLowerCase()
  let ti = 0
  let score = 0
  let run = 0
  for (let qi = 0; qi < lq.length; qi++) {
    const c = lq[qi]
    while (ti < lt.length && lt[ti] !== c) {
      ti++
      run = 0
    }
    if (ti >= lt.length) return null
    run++
    score += run * 2
    const prev = ti > 0 ? lt[ti - 1] : '/'
    if (prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ') {
      score += 8
    }
    ti++
  }
  // shorter targets win small tiebreaker
  score -= text.length * 0.05
  return score
}

// Filter a flat tree so that only names matching `q` remain — plus
// their tree ancestors, so the path context stays intact.
export function filterFlat(flat: FlatNode[], q: string): FlatNode[] {
  if (!q) return flat
  const lq = q.toLowerCase()
  const keep = new Set<string>()
  for (const n of flat) {
    if (n.name.toLowerCase().includes(lq)) keep.add(n.path)
  }
  // walk forward, tracking ancestors of matched nodes
  const ancestors: Record<string, string | null> = {}
  for (const n of flat) ancestors[n.path] = n.parentPath
  for (const path of [...keep]) {
    let p: string | null = path
    while (p) {
      const parent: string | null = ancestors[p] ?? null
      if (!parent) break
      keep.add(parent)
      p = parent
    }
  }
  return flat.filter(n => keep.has(n.path))
}
