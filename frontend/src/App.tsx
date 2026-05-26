import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import styles from './App.module.css'
import {
  loadBookmarks, saveBookmarks,
  loadExpanded, saveExpanded,
  loadFrecency, saveFrecency, bumpFrecency, frecencyScore,
  type FrecencyMap,
} from './storage'
import {
  type FileEntry, type FlatNode,
  parentPath, containingBookmark, ancestorsBetween,
  flattenTree, fuzzyScore, filterFlat,
} from './tree'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif'])
const PDF_EXTS = new Set(['.pdf'])
const HTML_EXTS = new Set(['.html', '.htm'])
const MD_EXTS = new Set(['.md', '.mdx', '.markdown'])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

function isImage(name: string): boolean { return IMAGE_EXTS.has(extOf(name)) }
function isPdf(name: string): boolean { return PDF_EXTS.has(extOf(name)) }
function isHtml(name: string): boolean { return HTML_EXTS.has(extOf(name)) }
function isMd(name: string): boolean { return MD_EXTS.has(extOf(name)) }

function isPreviewable(name: string): boolean {
  return isImage(name) || isPdf(name) || isHtml(name) || isMd(name)
}

function formatSize(size: number): string {
  if (size < 1024) return `${size}B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}K`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}M`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)}G`
}

function fileUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return <>
    {text.slice(0, idx)}
    <mark className={styles.queryHighlight}>{text.slice(idx, idx + query.length)}</mark>
    {text.slice(idx + query.length)}
  </>
}

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const parts = path.split('/').filter(Boolean)
  return (
    <nav className={styles.breadcrumb}>
      <span className={styles.crumb} onClick={() => onNavigate('/')}>/</span>
      {parts.map((part, i) => {
        const fullPath = '/' + parts.slice(0, i + 1).join('/')
        return (
          <span key={fullPath}>
            <span className={styles.crumbSep}>/</span>
            <span className={styles.crumb} onClick={() => onNavigate(fullPath)}>{part}</span>
          </span>
        )
      })}
    </nav>
  )
}

function NodeIcon({ node }: { node: FlatNode }) {
  if (node.isDir) {
    if (node.rootKind === 'bookmark') return <span className={styles.iconBookmark}>★</span>
    if (node.rootKind === 'current') return <span className={styles.iconCurrent}>◉</span>
    return <span className={styles.iconDir}>{node.expanded ? '▼' : '▶'}</span>
  }
  if (isImage(node.name)) return <span className={styles.iconImg}>◈</span>
  if (isPdf(node.name)) return <span className={styles.iconPdf}>⊠</span>
  if (isHtml(node.name)) return <span className={styles.iconHtml}>⊞</span>
  if (isMd(node.name)) return <span className={styles.iconMd}>❡</span>
  return <span className={styles.iconFile}>·</span>
}

const HELP_ROWS: [string, string][] = [
  ['j / ↓', 'カーソルを下に移動'],
  ['k / ↑', 'カーソルを上に移動'],
  ['g', 'リスト先頭へ'],
  ['G', 'リスト末尾へ'],
  ['/', '検索（カーソルジャンプ、Enter確定/Escキャンセル）'],
  ['n / N', '(検索確定後) 次 / 前のマッチへ'],
  ['f', 'フィルター（マッチのみ表示、Enter確定/Escクリア）'],
  ['l / → / Enter', '(ディレクトリ) 展開して中に入る'],
  ['h / ← / BS', '(展開中ディレクトリ) 折りたたむ / それ以外は親へ'],
  ['o', 'ファイルをタブで開く'],
  ['m', 'カーソル位置のディレクトリをブックマーク/解除'],
  ['Space / ;', 'ブックマーク/訪問先へ fuzzy ジャンプ'],
  ['v', 'リスト / ギャラリー切り替え'],
  ['Tab / Shift+Tab', '(タブあり) 次 / 前のタブへ'],
  ['d', '(タブあり) 今のタブを閉じる'],
  ['p', '(タブあり) 比較ビューに追加/解除'],
  ['F', '(タブあり) フォーカスモード（サイドバー等を非表示）'],
  ['+ / -', '(MD) フォントサイズ変更'],
  ['ホイール', '(画像) ズームイン / アウト（カーソル中心）'],
  ['ドラッグ', '(画像 ズーム中) パン移動'],
  ['ダブルクリック', '(画像) ズームリセット'],
  ['Esc', 'フォーカスモード終了 / 比較ビューを終了'],
  ['?', 'このヘルプを表示'],
]

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.helpOverlay} onClick={onClose}>
      <div className={styles.helpModal} onClick={e => e.stopPropagation()}>
        <div className={styles.helpHeader}>
          <span>キーボードショートカット</span>
          <button onClick={onClose}>✕</button>
        </div>
        <table className={styles.helpTable}>
          <tbody>
            {HELP_ROWS.map(([key, desc]) => (
              <tr key={key}>
                <td><kbd>{key}</kbd></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface TabBarProps {
  tabs: FileEntry[]
  activeTabPath: string | null
  splitPaths: string[]
  onTabClick: (path: string) => void
  onTabClose: (path: string) => void
  onToggleSplit: (path: string) => void
}

function TabBar({ tabs, activeTabPath, splitPaths, onTabClick, onTabClose, onToggleSplit }: TabBarProps) {
  return (
    <div className={styles.tabBar}>
      {tabs.map(tab => {
        const isPinned = splitPaths.includes(tab.path)
        const isActive = activeTabPath === tab.path
        return (
          <div
            key={tab.path}
            className={[styles.tab, isActive ? styles.tabActive : '', isPinned ? styles.tabPinned : ''].join(' ')}
            onClick={() => onTabClick(tab.path)}
          >
            <span className={styles.tabIcon}>
              {isImage(tab.name) ? '◈' : isPdf(tab.name) ? '⊠' : isHtml(tab.name) ? '⊞' : isMd(tab.name) ? '❡' : '·'}
            </span>
            <span className={styles.tabName}>{tab.name}</span>
            <button
              className={`${styles.tabBtn} ${isPinned ? styles.tabBtnPinned : ''}`}
              title={isPinned ? '比較から外す' : '比較ビューに追加 (p)'}
              onClick={e => { e.stopPropagation(); onToggleSplit(tab.path) }}
            >⊟</button>
            <button
              className={styles.tabBtn}
              title="タブを閉じる"
              onClick={e => { e.stopPropagation(); onTabClose(tab.path) }}
            >✕</button>
          </div>
        )
      })}
    </div>
  )
}

interface PreviewPaneProps {
  file: FileEntry
  isActive: boolean
  mdContent: string | null | undefined
  mdTheme: 'dark' | 'light' | 'academic' | 'pop'
  onMdThemeChange: (t: 'dark' | 'light' | 'academic' | 'pop') => void
  mdFontSize: number
  onMdFontSizeChange: (n: number) => void
  onClose: () => void
  onActivate: () => void
  closeTitle: string
}

function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  useEffect(() => { setScale(1); setTx(0); setTy(0) }, [src])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setScale(s => {
      const ns = Math.max(0.25, Math.min(20, s * factor))
      const ratio = ns / s
      setTx(t => cx - (cx - t) * ratio)
      setTy(t => cy - (cy - t) * ratio)
      return ns
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartRef.current = { x: e.clientX, y: e.clientY, tx, ty }
    setDragging(true)
  }, [tx, ty])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStartRef.current) return
    setTx(dragStartRef.current.tx + e.clientX - dragStartRef.current.x)
    setTy(dragStartRef.current.ty + e.clientY - dragStartRef.current.y)
  }, [])

  const onMouseUp = useCallback(() => { dragStartRef.current = null; setDragging(false) }, [])

  const onDblClick = useCallback(() => { setScale(1); setTx(0); setTy(0) }, [])

  const isZoomed = scale !== 1 || tx !== 0 || ty !== 0

  return (
    <div
      ref={containerRef}
      className={styles.previewImg}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDblClick}
      style={{ cursor: dragging ? 'grabbing' : isZoomed ? 'grab' : 'default' }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: 'center center',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function PreviewPane({ file, isActive, mdContent, mdTheme, onMdThemeChange, mdFontSize, onMdFontSizeChange, onClose, onActivate, closeTitle }: PreviewPaneProps) {
  return (
    <div
      className={`${styles.preview} ${isActive ? styles.previewActive : ''}`}
      onClick={onActivate}
    >
      <div className={styles.previewHeader}>
        <span className={styles.previewName}>{file.name}</span>
        <span className={styles.previewSize}>{formatSize(file.size)}</span>
        {isMd(file.name) && (
          <>
            <div className={styles.mdThemeToggle}>
              {(['dark', 'light', 'academic', 'pop'] as const).map(t => (
                <button
                  key={t}
                  className={mdTheme === t ? styles.active : ''}
                  onClick={e => { e.stopPropagation(); onMdThemeChange(t) }}
                >{t}</button>
              ))}
            </div>
            <div className={styles.fontSizeControls} onClick={e => e.stopPropagation()}>
              <button onClick={() => onMdFontSizeChange(Math.max(10, mdFontSize - 1))} title="フォント縮小 (-)">A-</button>
              <span className={styles.fontSizeValue}>{mdFontSize}</span>
              <button onClick={() => onMdFontSizeChange(Math.min(32, mdFontSize + 1))} title="フォント拡大 (+)">A+</button>
            </div>
          </>
        )}
        <button className={styles.closeBtn} title={closeTitle} onClick={e => { e.stopPropagation(); onClose() }}>✕</button>
      </div>
      {isImage(file.name) ? (
        <ZoomableImage src={fileUrl(file.path)} alt={file.name} />
      ) : isMd(file.name) ? (
        <div className={`${styles.previewMd} ${styles[`mdTheme_${mdTheme}`]}`} style={{ fontSize: mdFontSize }}>
          {mdContent === null || mdContent === undefined
            ? <span className={styles.mdLoading}>loading…</span>
            : <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{mdContent}</ReactMarkdown>
          }
        </div>
      ) : (
        <iframe
          className={styles.previewFrame}
          src={fileUrl(file.path)}
          title={file.name}
          sandbox={isHtml(file.name) ? 'allow-same-origin allow-scripts allow-forms' : undefined}
        />
      )}
    </div>
  )
}

interface JumpCandidate {
  path: string
  isBookmark: boolean
  score: number
}

interface JumpModalProps {
  candidates: string[]
  bookmarkSet: Set<string>
  frecency: FrecencyMap
  onPick: (path: string) => void
  onClose: () => void
}

function JumpModal({ candidates, bookmarkSet, frecency, onPick, onClose }: JumpModalProps) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const ranked = useMemo<JumpCandidate[]>(() => {
    const results: JumpCandidate[] = []
    for (const p of candidates) {
      const fz = fuzzyScore(p, q)
      if (fz === null) continue
      const fr = frecencyScore(frecency[p])
      const bookmarkBonus = bookmarkSet.has(p) ? 10 : 0
      results.push({ path: p, isBookmark: bookmarkSet.has(p), score: fz + fr + bookmarkBonus })
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, 50)
  }, [candidates, q, frecency, bookmarkSet])

  useEffect(() => { setIdx(0) }, [q])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const picked = ranked[idx]
      if (picked) onPick(picked.path)
    } else if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setIdx(i => Math.min(ranked.length - 1, i + 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setIdx(i => Math.max(0, i - 1))
    }
  }

  return (
    <div className={styles.helpOverlay} onClick={onClose}>
      <div className={styles.jumpModal} onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className={styles.jumpInput}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="ディレクトリを fuzzy 検索…"
        />
        <div className={styles.jumpList}>
          {ranked.length === 0 ? (
            <div className={styles.jumpEmpty}>マッチなし</div>
          ) : ranked.map((c, i) => (
            <div
              key={c.path}
              className={`${styles.jumpItem} ${i === idx ? styles.jumpItemActive : ''}`}
              onClick={() => onPick(c.path)}
              onMouseEnter={() => setIdx(i)}
            >
              <span className={styles.jumpItemIcon}>{c.isBookmark ? '★' : '·'}</span>
              <span className={styles.jumpItemPath}>{c.path}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [bookmarks, setBookmarks] = useState<string[]>(() => loadBookmarks())
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded())
  const [childrenCache, setChildrenCache] = useState<Record<string, FileEntry[]>>({})
  const [frecency, setFrecency] = useState<FrecencyMap>(() => loadFrecency())

  const [currentPath, setCurrentPath] = useState('')
  const [cursorPath, setCursorPath] = useState<string | null>(null)
  const [tabs, setTabs] = useState<FileEntry[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [splitPaths, setSplitPaths] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list')
  const [flashPath, setFlashPath] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const [mdContents, setMdContents] = useState<Record<string, string | null>>({})
  const [mdTheme, setMdTheme] = useState<'dark' | 'light' | 'academic' | 'pop'>('light')
  const [focusMode, setFocusMode] = useState(false)
  const [mdFontSize, setMdFontSize] = useState(15)
  const [query, setQuery] = useState('')
  const [queryMode, setQueryMode] = useState<'search' | 'filter' | null>(null)
  const [activeFilter, setActiveFilter] = useState('')
  const [activeSearch, setActiveSearch] = useState('')

  const queryInputRef = useRef<HTMLInputElement>(null)
  const prevPathRef = useRef('')
  const fetchedMd = useRef<Set<string>>(new Set())
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const childrenCacheRef = useRef<Record<string, FileEntry[]>>({})
  childrenCacheRef.current = childrenCache

  // Persist to localStorage.
  useEffect(() => { saveBookmarks(bookmarks) }, [bookmarks])
  useEffect(() => { saveExpanded(expanded) }, [expanded])
  useEffect(() => { saveFrecency(frecency) }, [frecency])

  const loadChildren = useCallback(async (path: string): Promise<FileEntry[]> => {
    const cached = childrenCacheRef.current[path]
    if (cached) return cached
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
    if (!res.ok) return []
    const data: FileEntry[] = await res.json()
    childrenCacheRef.current = { ...childrenCacheRef.current, [path]: data }
    setChildrenCache(prev => ({ ...prev, [path]: data }))
    return data
  }, [])

  // Refresh the currentPath's children (no cache) so SSE updates pick up
  // changes on disk.
  const refreshChildren = useCallback(async (path: string) => {
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
    if (!res.ok) return
    const data: FileEntry[] = await res.json()
    childrenCacheRef.current = { ...childrenCacheRef.current, [path]: data }
    setChildrenCache(prev => ({ ...prev, [path]: data }))
  }, [])

  const flat = useMemo(() => flattenTree({
    bookmarks, currentPath, expanded, children: childrenCache,
  }), [bookmarks, currentPath, expanded, childrenCache])

  const displayedFlat = useMemo(() => {
    const q = queryMode === 'filter' ? query : activeFilter
    return filterFlat(flat, q)
  }, [flat, query, queryMode, activeFilter])

  const highlightQuery = queryMode !== null ? query : activeFilter || activeSearch
  const cursorIndex = useMemo(
    () => cursorPath === null ? -1 : displayedFlat.findIndex(n => n.path === cursorPath),
    [cursorPath, displayedFlat],
  )

  // Ensure a path and all of its ancestors (within its containing root) are
  // expanded and have children loaded. Returns when all fetches finish.
  const expandToPath = useCallback(async (path: string) => {
    if (!path) return
    const root = containingBookmark(path, bookmarks) ?? path
    const chain = ancestorsBetween(root, path)
    setExpanded(prev => {
      const next = new Set(prev)
      for (const a of chain) next.add(a)
      return next
    })
    await Promise.all(chain.map(loadChildren))
  }, [bookmarks, loadChildren])

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path)
    setFrecency(prev => bumpFrecency(prev, path))
    expandToPath(path)
    setCursorPath(path)
  }, [expandToPath])

  // Boot: ask the server for currentPath, then subscribe to SSE for live
  // path changes triggered by `ssh-open` on the remote.
  useEffect(() => {
    fetch('/api/current-path')
      .then(r => r.json())
      .then(data => {
        const p: string = data.path
        prevPathRef.current = p
        setCurrentPath(p)
        setFrecency(prev => bumpFrecency(prev, p))
        expandToPath(p).then(() => setCursorPath(p))
      })

    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      const path = e.data.trim()
      if (!path) return
      if (path !== prevPathRef.current) {
        prevPathRef.current = path
        setCurrentPath(path)
        setFrecency(prev => bumpFrecency(prev, path))
        expandToPath(path).then(() => setCursorPath(path))
        // refresh the new dir's contents (in case it's been re-listed)
        refreshChildren(path)
        setFlashPath(true)
        setTimeout(() => setFlashPath(false), 800)
      }
    }
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset transient search/filter state when the currentPath itself changes
  // (similar to old behavior when entering a new directory).
  useEffect(() => {
    setQuery('')
    setQueryMode(null)
  }, [currentPath])

  // Jump cursor to first match when typing in search mode
  useEffect(() => {
    if (queryMode !== 'search' || !query) return
    const lq = query.toLowerCase()
    const hit = displayedFlat.find(n => n.name.toLowerCase().includes(lq))
    if (hit) setCursorPath(hit.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, queryMode])

  // Focus query input when query mode activates.
  useEffect(() => {
    if (queryMode !== null) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [queryMode])

  // Lazily fetch markdown content for newly-opened tabs.
  useEffect(() => {
    for (const t of tabs) {
      if (isMd(t.name) && !fetchedMd.current.has(t.path)) {
        fetchedMd.current.add(t.path)
        setMdContents(prev => ({ ...prev, [t.path]: null }))
        fetch(fileUrl(t.path))
          .then(r => r.text())
          .then(text => setMdContents(prev => ({ ...prev, [t.path]: text })))
      }
    }
  }, [tabs])

  useEffect(() => {
    if (cursorPath && rowRefs.current[cursorPath]) {
      rowRefs.current[cursorPath]?.scrollIntoView({ block: 'nearest' })
    }
  }, [cursorPath, displayedFlat.length])

  const openTab = useCallback((entry: FileEntry) => {
    setTabs(prev => prev.some(t => t.path === entry.path) ? prev : [...prev, entry])
    setActiveTabPath(entry.path)
  }, [])

  const closeTab = useCallback((path: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.path === path)
      const next = prev.filter(t => t.path !== path)
      setActiveTabPath(ap => ap !== path ? ap : next[Math.min(idx, next.length - 1)]?.path ?? null)
      return next
    })
    setSplitPaths(prev => prev.filter(p => p !== path))
    fetchedMd.current.delete(path)
    setMdContents(prev => { const n = { ...prev }; delete n[path]; return n })
  }, [])

  const toggleSplit = useCallback((path: string) => {
    setSplitPaths(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path])
  }, [])

  const cycleTab = useCallback((dir: 1 | -1) => {
    if (tabs.length === 0) return
    setActiveTabPath(ap => {
      const idx = tabs.findIndex(t => t.path === ap)
      return tabs[(idx + dir + tabs.length) % tabs.length]?.path ?? ap
    })
  }, [tabs])

  const toggleBookmark = useCallback((path: string) => {
    setBookmarks(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path])
  }, [])

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (!expanded.has(path)) loadChildren(path)
  }, [expanded, loadChildren])

  // Activate a node from the tree: directories navigate (and expand);
  // files open in a tab if previewable.
  const activateNode = useCallback((node: FlatNode) => {
    if (node.isDir) {
      setExpanded(prev => {
        const next = new Set(prev)
        next.add(node.path)
        return next
      })
      loadChildren(node.path)
      navigateTo(node.path)
    } else if (isPreviewable(node.name)) {
      const entry: FileEntry = {
        name: node.name, path: node.path, isDir: false, size: node.size, modTime: 0,
      }
      openTab(entry)
    }
  }, [loadChildren, navigateTo, openTab])

  // h: if cursor is on an expanded dir, collapse it; otherwise move the
  // cursor up the tree. If we are on the "current" root (no bookmark
  // contains currentPath), shift currentPath up by one segment so the
  // root itself walks toward /.
  const goLeft = useCallback(() => {
    if (cursorIndex < 0) return
    const node = displayedFlat[cursorIndex]
    if (!node) return
    if (node.isDir && expanded.has(node.path)) {
      setExpanded(prev => {
        const next = new Set(prev)
        next.delete(node.path)
        return next
      })
      return
    }
    if (node.parentPath) {
      setCursorPath(node.parentPath)
      return
    }
    // root with no parent in tree
    if (node.rootKind === 'current') {
      const parent = parentPath(node.path)
      if (parent) navigateTo(parent)
    }
  }, [cursorIndex, displayedFlat, expanded, navigateTo])

  // Candidates for fuzzy jump: bookmarks + every directory we have ever
  // listed children for (i.e. dirs the user has visited or expanded).
  const jumpCandidates = useMemo<string[]>(() => {
    const set = new Set<string>(bookmarks)
    for (const path of Object.keys(childrenCache)) set.add(path)
    for (const kids of Object.values(childrenCache)) {
      for (const k of kids) {
        if (k.isDir) set.add(k.path)
      }
    }
    return [...set]
  }, [bookmarks, childrenCache])
  const bookmarkSet = useMemo(() => new Set(bookmarks), [bookmarks])

  const hasTabs = tabs.length > 0
  const inSplitMode = splitPaths.length > 0
  const activeTab = tabs.find(t => t.path === activeTabPath) ?? null
  const splitTabs = splitPaths.map(p => tabs.find(t => t.path === p)).filter(Boolean) as FileEntry[]

  const onQueryKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setActiveFilter('')
      setQuery('')
      setQueryMode(null)
    } else if (e.key === 'Enter') {
      if (queryMode === 'filter') setActiveFilter(query)
      else if (queryMode === 'search') setActiveSearch(query)
      setQuery('')
      setQueryMode(null)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (displayedFlat.length === 0) return
      const next = Math.min(displayedFlat.length - 1, (cursorIndex < 0 ? -1 : cursorIndex) + 1)
      setCursorPath(displayedFlat[next].path)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (displayedFlat.length === 0) return
      const next = Math.max(0, (cursorIndex < 0 ? displayedFlat.length : cursorIndex) - 1)
      setCursorPath(displayedFlat[next].path)
    }
  }, [queryMode, query, displayedFlat, cursorIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (showHelp) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setShowHelp(false) }
        return
      }
      if (showJump) {
        // input inside the modal handles keys; nothing here
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        if (hasTabs) e.shiftKey ? cycleTab(-1) : cycleTab(1)
        return
      }

      const moveCursor = (delta: number) => {
        if (displayedFlat.length === 0) return
        if (cursorIndex < 0) {
          setCursorPath(displayedFlat[delta > 0 ? 0 : displayedFlat.length - 1].path)
          return
        }
        const next = (cursorIndex + delta + displayedFlat.length) % displayedFlat.length
        setCursorPath(displayedFlat[next].path)
      }

      switch (e.key) {
        case 'j': case 'ArrowDown':
          e.preventDefault(); moveCursor(1); return
        case 'k': case 'ArrowUp':
          e.preventDefault(); moveCursor(-1); return
        case 'g':
          if (displayedFlat.length > 0) setCursorPath(displayedFlat[0].path)
          return
        case 'G':
          if (displayedFlat.length > 0) setCursorPath(displayedFlat[displayedFlat.length - 1].path)
          return
        case '/':
          e.preventDefault()
          setQuery('')
          setQueryMode('search')
          return
        case 'f':
          setQuery('')
          setQueryMode('filter')
          return
        case 'n': case 'N': {
          if (!activeSearch) return
          const lq = activeSearch.toLowerCase()
          const dir = e.key === 'n' ? 1 : -1
          const len = displayedFlat.length
          if (len === 0) return
          const start = cursorIndex < 0 ? (dir === 1 ? -1 : 0) : cursorIndex
          for (let step = 1; step <= len; step++) {
            const i = ((start + dir * step) % len + len) % len
            if (displayedFlat[i].name.toLowerCase().includes(lq)) {
              setCursorPath(displayedFlat[i].path)
              return
            }
          }
          return
        }
        case 'v': setViewMode(m => m === 'list' ? 'gallery' : 'list'); return
        case '?': e.preventDefault(); setShowHelp(true); return
        case ' ': case ';':
          e.preventDefault()
          setShowJump(true)
          return
        case 'o': {
          if (cursorIndex >= 0) {
            const node = displayedFlat[cursorIndex]
            if (node && !node.isDir && isPreviewable(node.name)) {
              const entry: FileEntry = {
                name: node.name, path: node.path, isDir: false, size: node.size, modTime: 0,
              }
              openTab(entry)
            }
          }
          return
        }
        case 'Enter': case 'l': case 'ArrowRight':
          e.preventDefault()
          if (cursorIndex < 0) return
          activateNode(displayedFlat[cursorIndex])
          return
        case 'h': case 'ArrowLeft': case 'Backspace':
          e.preventDefault()
          goLeft()
          return
        case 'm': {
          if (cursorIndex < 0) {
            toggleBookmark(currentPath)
            return
          }
          const node = displayedFlat[cursorIndex]
          if (node?.isDir) toggleBookmark(node.path)
          else toggleBookmark(currentPath)
          return
        }
        case 'd':
          if (hasTabs && activeTabPath) closeTab(activeTabPath)
          return
        case 'p':
          if (hasTabs && activeTabPath) toggleSplit(activeTabPath)
          return
        case 'F':
          if (hasTabs) setFocusMode(m => !m)
          return
        case '+': case '=':
          setMdFontSize(s => Math.min(32, s + 1))
          return
        case '-':
          setMdFontSize(s => Math.max(10, s - 1))
          return
        case 'Escape':
          if (focusMode) setFocusMode(false)
          else if (inSplitMode) setSplitPaths([])
          else if (activeFilter) setActiveFilter('')
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasTabs, inSplitMode, focusMode, activeTabPath, showHelp, showJump, cursorIndex, displayedFlat, activeFilter, activeSearch, currentPath, openTab, closeTab, toggleSplit, cycleTab, activateNode, goLeft, toggleBookmark])

  const galleryFiles = (childrenCache[currentPath] ?? []).filter(f => !f.isDir && isImage(f.name))

  return (
    <div className={styles.app}>
      {!focusMode && <header className={styles.header}>
        <span className={styles.logo}>ssh-open</span>
        <Breadcrumb path={currentPath} onNavigate={navigateTo} />
        <span className={`${styles.flash} ${flashPath ? styles.flashActive : ''}`}>↺</span>
        <button className={styles.helpBtn} onClick={() => setShowJump(true)} title="Jump (Space or ;)">⤳</button>
        <div className={styles.viewToggle}>
          <button className={viewMode === 'list' ? styles.active : ''} onClick={() => setViewMode('list')} title="List view (v)">≡</button>
          <button className={viewMode === 'gallery' ? styles.active : ''} onClick={() => setViewMode('gallery')} title="Gallery view (v)">⊞</button>
        </div>
        <button className={styles.helpBtn} onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)">?</button>
      </header>}

      {!focusMode && hasTabs && (
        <TabBar
          tabs={tabs}
          activeTabPath={activeTabPath}
          splitPaths={splitPaths}
          onTabClick={setActiveTabPath}
          onTabClose={closeTab}
          onToggleSplit={toggleSplit}
        />
      )}

      <div className={styles.body}>
        {!focusMode && <div className={`${styles.panel} ${hasTabs ? styles.panelNarrow : ''}`}>
          {viewMode === 'list' ? (
            <div className={styles.fileList}>
              {queryMode !== null && (
                <div className={styles.queryBar}>
                  <span className={styles.queryLabel}>{queryMode === 'search' ? '/' : 'f'}</span>
                  <input
                    ref={queryInputRef}
                    className={styles.queryInput}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={onQueryKeyDown}
                    placeholder={queryMode === 'search' ? 'search...' : 'filter...'}
                  />
                  <button
                    className={styles.queryClose}
                    onClick={() => {
                      setActiveFilter('')
                      setQuery('')
                      setQueryMode(null)
                    }}
                  >✕</button>
                </div>
              )}
              {activeFilter && queryMode === null && (
                <div className={styles.filterBadge}>
                  <span className={styles.filterBadgeLabel}>f: {activeFilter}</span>
                  <button
                    className={styles.filterBadgeClear}
                    onClick={() => setActiveFilter('')}
                    title="フィルターをクリア"
                  >✕</button>
                </div>
              )}
              {bookmarks.length === 0 && (
                <div className={styles.bookmarksHint}>
                  <span>★ <kbd>m</kbd> でディレクトリをブックマーク、<kbd>Space</kbd> で fuzzy ジャンプ</span>
                </div>
              )}
              {displayedFlat.length === 0 && (
                <div className={styles.emptyHint}>表示できる項目がありません</div>
              )}
              {displayedFlat.map(n => {
                const inTab = tabs.some(t => t.path === n.path)
                const isActiveTab = activeTabPath === n.path
                const isCursor = cursorPath === n.path
                const isCurrent = currentPath === n.path && n.isDir
                const isBookmark = bookmarkSet.has(n.path)
                return (
                  <div
                    key={n.path}
                    ref={el => { rowRefs.current[n.path] = el }}
                    className={[
                      styles.fileRow,
                      n.isDir ? styles.dirRow : '',
                      n.rootKind ? styles.rootRow : '',
                      inTab ? styles.openRow : '',
                      isActiveTab ? styles.selectedRow : '',
                      isCursor ? styles.cursorRow : '',
                      isCurrent ? styles.currentDirRow : '',
                    ].join(' ')}
                    style={{ paddingLeft: 8 + n.depth * 14 }}
                    title={n.path}
                    onClick={() => {
                      if (n.isDir) {
                        toggleExpand(n.path)
                        navigateTo(n.path)
                      } else if (isPreviewable(n.name)) {
                        const entry: FileEntry = {
                          name: n.name, path: n.path, isDir: false, size: n.size, modTime: 0,
                        }
                        openTab(entry)
                      }
                      setCursorPath(n.path)
                    }}
                  >
                    <NodeIcon node={n} />
                    <span className={styles.fileName}>
                      <HighlightMatch text={n.name} query={highlightQuery} />
                      {isBookmark && n.rootKind !== 'bookmark' && <span className={styles.bookmarkBadge}>★</span>}
                    </span>
                    {!n.isDir && <span className={styles.fileSize}>{formatSize(n.size)}</span>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className={styles.gallery}>
              {galleryFiles.length === 0 ? (
                <p className={styles.empty}>No images</p>
              ) : (
                galleryFiles.map(f => (
                  <div
                    key={f.path}
                    className={`${styles.thumb} ${tabs.some(t => t.path === f.path) ? styles.thumbSelected : ''}`}
                    onClick={() => openTab(f)}
                  >
                    <img src={fileUrl(f.path)} alt={f.name} loading="lazy" />
                    <span>{f.name}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>}

        {inSplitMode ? (
          (() => {
            const displayFiles = [...splitTabs]
            if (activeTab && !splitPaths.includes(activeTab.path)) displayFiles.push(activeTab)
            return displayFiles.map(file => {
              const isPinned = splitPaths.includes(file.path)
              return (
                <PreviewPane
                  key={file.path}
                  file={file}
                  isActive={activeTabPath === file.path}
                  mdContent={mdContents[file.path]}
                  mdTheme={mdTheme}
                  onMdThemeChange={setMdTheme}
                  mdFontSize={mdFontSize}
                  onMdFontSizeChange={setMdFontSize}
                  onClose={() => isPinned ? toggleSplit(file.path) : closeTab(file.path)}
                  onActivate={() => setActiveTabPath(file.path)}
                  closeTitle={isPinned ? "比較から外す" : "タブを閉じる"}
                />
              )
            })
          })()
        ) : activeTab ? (
          <PreviewPane
            file={activeTab}
            isActive={false}
            mdContent={mdContents[activeTab.path]}
            mdTheme={mdTheme}
            onMdThemeChange={setMdTheme}
            mdFontSize={mdFontSize}
            onMdFontSizeChange={setMdFontSize}
            onClose={() => closeTab(activeTab.path)}
            onActivate={() => {}}
            closeTitle="タブを閉じる"
          />
        ) : null}
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showJump && (
        <JumpModal
          candidates={jumpCandidates}
          bookmarkSet={bookmarkSet}
          frecency={frecency}
          onClose={() => setShowJump(false)}
          onPick={(p) => {
            setShowJump(false)
            navigateTo(p)
          }}
        />
      )}
    </div>
  )
}
