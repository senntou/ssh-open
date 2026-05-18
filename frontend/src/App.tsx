import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  ['j / ↓', 'カーソルを下に移動'],
  ['k / ↑', 'カーソルを上に移動'],
  ['g', 'リスト先頭へ'],
  ['G', 'リスト末尾へ'],
  ['o / Enter', 'ファイルをタブで開く'],
  ['l / → / Enter', '(ディレクトリ) 中に入る'],
  ['h / ← / BS', '親ディレクトリへ'],
  ['v', 'リスト / ギャラリー切り替え'],
  ['Tab / Shift+Tab', '(タブあり) 次 / 前のタブへ'],
  ['p', '(タブあり) 比較ビューに追加/解除'],
  ['Esc', '比較ビューを終了'],
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
  onClose: () => void
  onActivate: () => void
  closeTitle: string
}

function PreviewPane({ file, isActive, mdContent, mdTheme, onMdThemeChange, onClose, onActivate, closeTitle }: PreviewPaneProps) {
  return (
    <div
      className={`${styles.preview} ${isActive ? styles.previewActive : ''}`}
      onClick={onActivate}
    >
      <div className={styles.previewHeader}>
        <span className={styles.previewName}>{file.name}</span>
        <span className={styles.previewSize}>{formatSize(file.size)}</span>
        {isMd(file.name) && (
          <div className={styles.mdThemeToggle}>
            {(['dark', 'light', 'academic', 'pop'] as const).map(t => (
              <button
                key={t}
                className={mdTheme === t ? styles.active : ''}
                onClick={e => { e.stopPropagation(); onMdThemeChange(t) }}
              >{t}</button>
            ))}
          </div>
        )}
        <button className={styles.closeBtn} title={closeTitle} onClick={e => { e.stopPropagation(); onClose() }}>✕</button>
      </div>
      {isImage(file.name) ? (
        <div className={styles.previewImg}>
          <img src={fileUrl(file.path)} alt={file.name} />
        </div>
      ) : isMd(file.name) ? (
        <div className={`${styles.previewMd} ${styles[`mdTheme_${mdTheme}`]}`}>
          {mdContent === null || mdContent === undefined
            ? <span className={styles.mdLoading}>loading…</span>
            : <ReactMarkdown remarkPlugins={[remarkGfm]}>{mdContent}</ReactMarkdown>
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
  const prevPathRef = useRef('')
  const fetchedMd = useRef<Set<string>>(new Set())
  const upRowRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const loadFiles = useCallback(async (path: string) => {
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
    if (res.ok) setFiles(await res.json())
  }, [])

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path)
    loadFiles(path)
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
    rowRefs.current = []
  }, [currentPath])

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
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    navigateTo(parent)
  }, [currentPath, navigateTo])

  const imageFiles = files.filter(f => !f.isDir && isImage(f.name))
  const hasTabs = tabs.length > 0
  const inSplitMode = splitPaths.length > 0
  const activeTab = tabs.find(t => t.path === activeTabPath) ?? null
  const splitTabs = splitPaths.map(p => tabs.find(t => t.path === p)).filter(Boolean) as FileEntry[]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (showHelp) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setShowHelp(false) }
        return
      }

      // Tab / Shift+Tab: タブ切り替え（タブがある場合）
      if (e.key === 'Tab') {
        e.preventDefault()
        if (hasTabs) e.shiftKey ? cycleTab(-1) : cycleTab(1)
        return
      }

      switch (e.key) {
        case 'j': case 'ArrowDown':
          e.preventDefault()
          setCursorIndex(i => Math.min(i + 1, files.length - 1))
          return
        case 'k': case 'ArrowUp':
          e.preventDefault()
          setCursorIndex(i => Math.max(i - 1, -1))
          return
        case 'g': setCursorIndex(-1); return
        case 'G': setCursorIndex(files.length - 1); return
        case 'v': setViewMode(m => m === 'list' ? 'gallery' : 'list'); return
        case '?': e.preventDefault(); setShowHelp(true); return
        case 'o': {
          if (cursorIndex >= 0) {
            const entry = files[cursorIndex]
            if (entry && isPreviewable(entry.name)) openTab(entry)
          }
          return
        }
        case 'Enter': {
          e.preventDefault()
          if (cursorIndex === -1) { navigateUp(); return }
          const entry = files[cursorIndex]
          if (!entry) return
          if (entry.isDir) navigateTo(entry.path)
          else if (isPreviewable(entry.name)) openTab(entry)
          return
        }
        case 'l': case 'ArrowRight':
          e.preventDefault()
          if (cursorIndex === -1) navigateUp()
          else { const entry = files[cursorIndex]; if (entry?.isDir) navigateTo(entry.path) }
          return
        case 'h': case 'ArrowLeft': case 'Backspace':
          e.preventDefault()
          navigateUp()
          return
        case 'p':
          if (hasTabs && activeTabPath) toggleSplit(activeTabPath)
          return
        case 'Escape':
          if (inSplitMode) setSplitPaths([])
          else setCursorIndex(-1)
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasTabs, inSplitMode, activeTabPath, showHelp, cursorIndex, files, openTab, closeTab, toggleSplit, cycleTab, navigateUp, navigateTo])

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.logo}>ssh-open</span>
        <Breadcrumb path={currentPath} onNavigate={navigateTo} />
        <span className={`${styles.flash} ${flashPath ? styles.flashActive : ''}`}>↺</span>
        <div className={styles.viewToggle}>
          <button className={viewMode === 'list' ? styles.active : ''} onClick={() => setViewMode('list')} title="List view (v)">≡</button>
          <button className={viewMode === 'gallery' ? styles.active : ''} onClick={() => setViewMode('gallery')} title="Gallery view (v)">⊞</button>
        </div>
        <button className={styles.helpBtn} onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)">?</button>
      </header>

      {hasTabs && (
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
        <div className={`${styles.panel} ${hasTabs ? styles.panelNarrow : ''}`}>
          {viewMode === 'list' ? (
            <div className={styles.fileList}>
              <div
                ref={upRowRef}
                className={`${styles.fileRow} ${styles.dirRow} ${cursorIndex === -1 ? styles.cursorRow : ''}`}
                onClick={navigateUp}
              >
                <span className={styles.iconDir}>▲</span>
                <span className={styles.fileName}>..</span>
              </div>
              {files.map((f, i) => (
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
                  <span className={styles.fileName}>{f.name}</span>
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
        </div>

        {inSplitMode ? (
          splitTabs.map(file => (
            <PreviewPane
              key={file.path}
              file={file}
              isActive={activeTabPath === file.path}
              mdContent={mdContents[file.path]}
              mdTheme={mdTheme}
              onMdThemeChange={setMdTheme}
              onClose={() => toggleSplit(file.path)}
              onActivate={() => setActiveTabPath(file.path)}
              closeTitle="比較から外す"
            />
          ))
        ) : activeTab ? (
          <PreviewPane
            file={activeTab}
            isActive={false}
            mdContent={mdContents[activeTab.path]}
            mdTheme={mdTheme}
            onMdThemeChange={setMdTheme}
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
