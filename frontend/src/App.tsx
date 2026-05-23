import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import styles from './App.module.css'

interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modTime: number
}

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

function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.isDir) return <span className={styles.iconDir}>▶</span>
  if (isImage(entry.name)) return <span className={styles.iconImg}>◈</span>
  if (isPdf(entry.name)) return <span className={styles.iconPdf}>⊠</span>
  if (isHtml(entry.name)) return <span className={styles.iconHtml}>⊞</span>
  if (isMd(entry.name)) return <span className={styles.iconMd}>❡</span>
  return <span className={styles.iconFile}>·</span>
}

const HELP_ROWS: [string, string][] = [
  ['j / ↓', 'カーソルを下に移動（末尾で折り返し）'],
  ['k / ↑', 'カーソルを上に移動（先頭で折り返し）'],
  ['g', 'リスト先頭へ'],
  ['G', 'リスト末尾へ'],
  ['/', '検索（カーソルジャンプ、Enter確定/Escキャンセル）'],
  ['n / N', '(検索確定後) 次 / 前のマッチへ'],
  ['f', 'フィルター（マッチのみ表示、Enter確定/Escクリア）'],
  ['o / Enter', 'ファイルをタブで開く'],
  ['l / → / Enter', '(ディレクトリ) 中に入る'],
  ['h / ← / BS', '親ディレクトリへ'],
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
            <FileIcon entry={tab} />
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

export default function App() {
  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [tabs, setTabs] = useState<FileEntry[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [splitPaths, setSplitPaths] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list')
  const [flashPath, setFlashPath] = useState(false)
  const [cursorIndex, setCursorIndex] = useState(-1)
  const [showHelp, setShowHelp] = useState(false)
  const [mdContents, setMdContents] = useState<Record<string, string | null>>({})
  const [mdTheme, setMdTheme] = useState<'dark' | 'light' | 'academic' | 'pop'>('light')
  const [focusMode, setFocusMode] = useState(false)
  const [mdFontSize, setMdFontSize] = useState(15)
  const [query, setQuery] = useState('')
  const [queryMode, setQueryMode] = useState<'search' | 'filter' | null>(null)
  const [activeFilter, setActiveFilter] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const queryInputRef = useRef<HTMLInputElement>(null)
  const savedCursorRef = useRef<number>(-1)
  const prevPathRef = useRef('')
  const fetchedMd = useRef<Set<string>>(new Set())
  const upRowRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const displayedFiles = useMemo(() => {
    const q = queryMode === 'filter' ? query : activeFilter
    if (!q) return files
    const lq = q.toLowerCase()
    return files.filter(f => f.name.toLowerCase().includes(lq))
  }, [files, query, queryMode, activeFilter])

  const highlightQuery = queryMode !== null ? query : activeFilter || activeSearch

  const loadFiles = useCallback(async (path: string, focusName?: string) => {
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
    if (res.ok) {
      const newFiles: FileEntry[] = await res.json()
      setFiles(newFiles)
      if (focusName) {
        const idx = newFiles.findIndex(f => f.name === focusName)
        if (idx !== -1) setCursorIndex(idx)
      }
    }
  }, [])

  const navigateTo = useCallback((path: string, focusName?: string) => {
    setCurrentPath(path)
    loadFiles(path, focusName)
  }, [loadFiles])

  useEffect(() => {
    fetch('/api/current-path')
      .then(r => r.json())
      .then(data => {
        setCurrentPath(data.path)
        prevPathRef.current = data.path
        loadFiles(data.path)
      })

    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      const path = e.data.trim()
      if (!path) return
      if (path !== prevPathRef.current) {
        prevPathRef.current = path
        setCurrentPath(path)
        loadFiles(path)
        setFlashPath(true)
        setTimeout(() => setFlashPath(false), 800)
      }
    }
    return () => es.close()
  }, [loadFiles])

  useEffect(() => {
    setCursorIndex(-1)
    setQuery('')
    setQueryMode(null)
    setActiveFilter('')
    rowRefs.current = []
  }, [currentPath])

  // Jump cursor to first match when typing in search mode
  useEffect(() => {
    if (queryMode !== 'search' || !query) return
    const idx = files.findIndex(f => f.name.toLowerCase().includes(query.toLowerCase()))
    if (idx !== -1) setCursorIndex(idx)
  }, [query, queryMode, files])

  // Reset cursor when filter query changes
  useEffect(() => {
    if (queryMode === 'filter') setCursorIndex(-1)
  }, [query, queryMode])

  // Focus query input when mode activates (setTimeout to avoid the trigger key being typed in)
  useEffect(() => {
    if (queryMode !== null) {
      const t = setTimeout(() => queryInputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [queryMode])

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
    if (cursorIndex === -1) {
      upRowRef.current?.scrollIntoView({ block: 'nearest' })
    } else {
      rowRefs.current[cursorIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [cursorIndex])

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

  const navigateUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean)
    const dirName = parts.length > 0 ? parts[parts.length - 1] : undefined
    const parent = '/' + parts.slice(0, -1).join('/')
    navigateTo(parent, dirName)
  }, [currentPath, navigateTo])

  const imageFiles = files.filter(f => !f.isDir && isImage(f.name))
  const hasTabs = tabs.length > 0
  const inSplitMode = splitPaths.length > 0
  const activeTab = tabs.find(t => t.path === activeTabPath) ?? null
  const splitTabs = splitPaths.map(p => tabs.find(t => t.path === p)).filter(Boolean) as FileEntry[]

  const onQueryKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (queryMode === 'search') setCursorIndex(savedCursorRef.current)
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
      setCursorIndex(i => i >= displayedFiles.length - 1 ? -1 : i + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursorIndex(i => i <= -1 ? displayedFiles.length - 1 : i - 1)
    }
  }, [queryMode, query, displayedFiles.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (showHelp) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setShowHelp(false) }
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        if (hasTabs) e.shiftKey ? cycleTab(-1) : cycleTab(1)
        return
      }

      switch (e.key) {
        case 'j': case 'ArrowDown':
          e.preventDefault()
          setCursorIndex(i => i >= displayedFiles.length - 1 ? -1 : i + 1)
          return
        case 'k': case 'ArrowUp':
          e.preventDefault()
          setCursorIndex(i => i <= -1 ? displayedFiles.length - 1 : i - 1)
          return
        case 'g': setCursorIndex(-1); return
        case 'G': setCursorIndex(displayedFiles.length - 1); return
        case '/':
          e.preventDefault()
          savedCursorRef.current = cursorIndex
          setQuery('')
          setQueryMode('search')
          return
        case 'f':
          savedCursorRef.current = cursorIndex
          setQuery('')
          setQueryMode('filter')
          return
        case 'n': case 'N': {
          if (!activeSearch) return
          const lq = activeSearch.toLowerCase()
          const dir = e.key === 'n' ? 1 : -1
          const len = displayedFiles.length
          let found = -1
          for (let step = 1; step <= len; step++) {
            const idx = ((cursorIndex === -1 ? (dir === 1 ? -1 : 0) : cursorIndex) + dir * step + len) % len
            if (displayedFiles[idx]?.name.toLowerCase().includes(lq)) { found = idx; break }
          }
          if (found !== -1) setCursorIndex(found)
          return
        }
        case 'v': setViewMode(m => m === 'list' ? 'gallery' : 'list'); return
        case '?': e.preventDefault(); setShowHelp(true); return
        case 'o': {
          if (cursorIndex >= 0) {
            const entry = displayedFiles[cursorIndex]
            if (entry && isPreviewable(entry.name)) openTab(entry)
          }
          return
        }
        case 'Enter': {
          e.preventDefault()
          if (cursorIndex === -1) { navigateUp(); return }
          const entry = displayedFiles[cursorIndex]
          if (!entry) return
          if (entry.isDir) navigateTo(entry.path)
          else if (isPreviewable(entry.name)) openTab(entry)
          return
        }
        case 'l': case 'ArrowRight':
          e.preventDefault()
          if (cursorIndex === -1) navigateUp()
          else { const entry = displayedFiles[cursorIndex]; if (entry?.isDir) navigateTo(entry.path) }
          return
        case 'h': case 'ArrowLeft': case 'Backspace':
          e.preventDefault()
          navigateUp()
          return
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
          if (focusMode) { setFocusMode(false) }
          else if (inSplitMode) setSplitPaths([])
          else setCursorIndex(-1)
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasTabs, inSplitMode, focusMode, activeTabPath, showHelp, cursorIndex, displayedFiles, activeFilter, activeSearch, openTab, closeTab, toggleSplit, cycleTab, navigateUp, navigateTo, tabs, mdFontSize])

  return (
    <div className={styles.app}>
      {!focusMode && <header className={styles.header}>
        <span className={styles.logo}>ssh-open</span>
        <Breadcrumb path={currentPath} onNavigate={navigateTo} />
        <span className={`${styles.flash} ${flashPath ? styles.flashActive : ''}`}>↺</span>
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
                      if (queryMode === 'search') setCursorIndex(savedCursorRef.current)
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
              <div
                ref={upRowRef}
                className={`${styles.fileRow} ${styles.dirRow} ${cursorIndex === -1 ? styles.cursorRow : ''}`}
                onClick={navigateUp}
              >
                <span className={styles.iconDir}>▲</span>
                <span className={styles.fileName}>..</span>
              </div>
              {displayedFiles.map((f, i) => (
                <div
                  key={f.path}
                  ref={el => { rowRefs.current[i] = el }}
                  className={[
                    styles.fileRow,
                    f.isDir ? styles.dirRow : '',
                    tabs.some(t => t.path === f.path) ? styles.openRow : '',
                    activeTabPath === f.path ? styles.selectedRow : '',
                    cursorIndex === i ? styles.cursorRow : '',
                  ].join(' ')}
                  onClick={() => f.isDir ? navigateTo(f.path) : isPreviewable(f.name) ? openTab(f) : null}
                >
                  <FileIcon entry={f} />
                  <span className={styles.fileName}>
                    <HighlightMatch text={f.name} query={highlightQuery} />
                  </span>
                  {!f.isDir && <span className={styles.fileSize}>{formatSize(f.size)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.gallery}>
              {imageFiles.length === 0 ? (
                <p className={styles.empty}>No images</p>
              ) : (
                imageFiles.map(f => (
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
    </div>
  )
}
