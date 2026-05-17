import { useState, useEffect, useCallback, useRef } from 'react'
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

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

function isImage(name: string): boolean {
  return IMAGE_EXTS.has(extOf(name))
}

function isPdf(name: string): boolean {
  return PDF_EXTS.has(extOf(name))
}

function isHtml(name: string): boolean {
  return HTML_EXTS.has(extOf(name))
}

function isPreviewable(name: string): boolean {
  return isImage(name) || isPdf(name) || isHtml(name)
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
      <span className={styles.crumb} onClick={() => onNavigate('/')}>
        /
      </span>
      {parts.map((part, i) => {
        const fullPath = '/' + parts.slice(0, i + 1).join('/')
        return (
          <span key={fullPath}>
            <span className={styles.crumbSep}>/</span>
            <span className={styles.crumb} onClick={() => onNavigate(fullPath)}>
              {part}
            </span>
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
  return <span className={styles.iconFile}>·</span>
}

const HELP_ROWS: [string, string][] = [
  ['j / ↓', 'カーソルを下に移動'],
  ['k / ↑', 'カーソルを上に移動'],
  ['g', 'リスト先頭へ'],
  ['G', 'リスト末尾へ'],
  ['o', 'ファイルをプレビュー'],
  ['Enter / l / →', 'ディレクトリを開く'],
  ['h / ← / BS', '親ディレクトリへ'],
  ['v / Tab', 'リスト / ギャラリー切り替え'],
  ['← / h', '(プレビュー中) 前の画像'],
  ['→ / l', '(プレビュー中) 次の画像'],
  ['Esc', 'プレビューを閉じる'],
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

export default function App() {
  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list')
  const [flashPath, setFlashPath] = useState(false)
  const [cursorIndex, setCursorIndex] = useState(-1)
  const [showHelp, setShowHelp] = useState(false)
  const prevPathRef = useRef('')
  const upRowRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  const loadFiles = useCallback(async (path: string) => {
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
    if (res.ok) {
      setFiles(await res.json())
      setSelected(null)
    }
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
    if (cursorIndex === -1) {
      upRowRef.current?.scrollIntoView({ block: 'nearest' })
    } else {
      rowRefs.current[cursorIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [cursorIndex])

  const imageFiles = files.filter(f => !f.isDir && isImage(f.name))

  const cycleImage = useCallback((dir: 1 | -1) => {
    setSelected(prev => {
      if (!prev) return prev
      const idx = imageFiles.findIndex(f => f.path === prev.path)
      return imageFiles[(idx + dir + imageFiles.length) % imageFiles.length] ?? prev
    })
  }, [imageFiles])

  const navigateUp = useCallback(() => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    navigateTo(parent)
  }, [currentPath, navigateTo])

  const navigateEntry = useCallback((entry: FileEntry) => {
    if (entry.isDir) {
      navigateTo(entry.path)
    } else if (isPreviewable(entry.name)) {
      setSelected(entry)
    }
  }, [navigateTo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (showHelp) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setShowHelp(false) }
        return
      }

      // Always available regardless of preview state
      switch (e.key) {
        case 'j': case 'ArrowDown':
          e.preventDefault()
          setCursorIndex(i => Math.min(i + 1, files.length - 1))
          return
        case 'k': case 'ArrowUp':
          e.preventDefault()
          setCursorIndex(i => Math.max(i - 1, -1))
          return
        case 'g':
          setCursorIndex(-1)
          return
        case 'G':
          setCursorIndex(files.length - 1)
          return
        case 'o': {
          if (cursorIndex >= 0) {
            const entry = files[cursorIndex]
            if (entry && isPreviewable(entry.name)) setSelected(entry)
          }
          return
        }
        case 'v':
          setViewMode(m => m === 'list' ? 'gallery' : 'list')
          return
        case 'Tab':
          e.preventDefault()
          setViewMode(m => m === 'list' ? 'gallery' : 'list')
          return
        case '?':
          e.preventDefault()
          setShowHelp(true)
          return
      }

      if (selected) {
        switch (e.key) {
          case 'Escape': setSelected(null); break
          case 'ArrowRight': case 'l': cycleImage(1); break
          case 'ArrowLeft': case 'h': cycleImage(-1); break
        }
      } else {
        switch (e.key) {
          case 'Enter': case 'l': case 'ArrowRight':
            e.preventDefault()
            if (cursorIndex === -1) navigateUp()
            else { const entry = files[cursorIndex]; if (entry?.isDir) navigateTo(entry.path) }
            break
          case 'h': case 'ArrowLeft': case 'Backspace':
            e.preventDefault()
            navigateUp()
            break
          case 'Escape':
            setCursorIndex(-1)
            break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, showHelp, cursorIndex, files, cycleImage, navigateUp, navigateTo])

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.logo}>ssh-open</span>
        <Breadcrumb path={currentPath} onNavigate={navigateTo} />
        <span className={`${styles.flash} ${flashPath ? styles.flashActive : ''}`}>↺</span>
        <div className={styles.viewToggle}>
          <button
            className={viewMode === 'list' ? styles.active : ''}
            onClick={() => setViewMode('list')}
            title="List view (v)"
          >
            ≡
          </button>
          <button
            className={viewMode === 'gallery' ? styles.active : ''}
            onClick={() => setViewMode('gallery')}
            title="Gallery view (v)"
          >
            ⊞
          </button>
        </div>
        <button className={styles.helpBtn} onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)">?</button>
      </header>

      <div className={styles.body}>
        <div className={`${styles.panel} ${selected ? styles.panelNarrow : ''}`}>
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
                  className={`${styles.fileRow} ${f.isDir ? styles.dirRow : ''} ${selected?.path === f.path ? styles.selectedRow : ''} ${cursorIndex === i ? styles.cursorRow : ''}`}
                  onClick={() => navigateEntry(f)}
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
                    className={`${styles.thumb} ${selected?.path === f.path ? styles.thumbSelected : ''}`}
                    onClick={() => setSelected(f)}
                  >
                    <img src={fileUrl(f.path)} alt={f.name} loading="lazy" />
                    <span>{f.name}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {selected && (
          <div className={styles.preview}>
            <div className={styles.previewHeader}>
              <span className={styles.previewName}>{selected.name}</span>
              <span className={styles.previewSize}>{formatSize(selected.size)}</span>
              <button className={styles.closeBtn} onClick={() => setSelected(null)}>✕</button>
            </div>
            {isImage(selected.name) ? (
              <>
                <div className={styles.previewImg}>
                  <button className={styles.navBtn} onClick={() => cycleImage(-1)}>‹</button>
                  <img src={fileUrl(selected.path)} alt={selected.name} />
                  <button className={styles.navBtn} onClick={() => cycleImage(1)}>›</button>
                </div>
                <div className={styles.previewFooter}>
                  {imageFiles.findIndex(f => f.path === selected.path) + 1} / {imageFiles.length}
                </div>
              </>
            ) : (
              <iframe
                className={styles.previewFrame}
                src={fileUrl(selected.path)}
                title={selected.name}
                sandbox={isHtml(selected.name) ? 'allow-same-origin allow-scripts allow-forms' : undefined}
              />
            )}
          </div>
        )}
      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}
