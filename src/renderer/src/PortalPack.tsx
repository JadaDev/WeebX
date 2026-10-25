import { useEffect, useState } from 'react'
import { Database, FolderOpen, Globe2, Orbit, PackageOpen, Sparkles } from 'lucide-react'
import type { PortalProgress } from '../../shared/types'
import { ActionButton } from './ActionButton'

type Runner = <T>(operation: () => Promise<T>, after?: boolean) => Promise<T | undefined>

export function PortalPack({ run }: { run: Runner }) {
  const [includeDb, setIncludeDb] = useState(true)
  const [includeHtdocs, setIncludeHtdocs] = useState(true)
  const [progress, setProgress] = useState<PortalProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => window.weebx.onPortalProgress(setProgress), [])

  const busy = Boolean(progress && progress.phase !== 'complete' && progress.phase !== 'error')

  const pack = async () => {
    setResult(null)
    const packed = await run(() => window.weebx.packPortal({ includeDb, includeHtdocs }), false)
    if (packed) setResult(packed.folder)
    return packed !== undefined
  }

  const unpack = async () => {
    setResult(null)
    const packed = await run(() => window.weebx.unpackPortal(), false)
    if (packed) setResult(packed.folder)
    return packed !== undefined
  }

  return <>
    <div className="portal-hero">
      <div>
        <span className="eyebrow"><Orbit size={14} /> PORTAL PACKING</span>
        <h2>Fold WeebX into a portal,<br /><em>open it anywhere.</em></h2>
        <p>Pack the app, Apache, PHP, and MariaDB into one folder. Copy it to another disk or machine, launch it, and WeebX repairs every path.</p>
      </div>
      <div className="portal-viz" aria-hidden>
        <i /><i /><i />
        <span><Sparkles size={28} /></span>
      </div>
    </div>
    <div className="portal-grid">
      <article className="portal-card">
        <div className="portal-glyph pack"><Orbit size={22} /></div>
        <h3>Open a portal</h3>
        <p>Choose a destination folder. WeebX writes a portable copy you can move freely.</p>
        <div className="portal-options">
          <button type="button" className={includeDb ? 'on' : ''} onClick={() => setIncludeDb((value) => !value)}>
            <Database size={16} /><span><b>Pack databases</b>MariaDB data folder</span>
          </button>
          <button type="button" className={includeHtdocs ? 'on' : ''} onClick={() => setIncludeHtdocs((value) => !value)}>
            <Globe2 size={16} /><span><b>Pack websites</b>All files in htdocs</span>
          </button>
        </div>
        <ActionButton className="primary" working={busy} icon={<Sparkles size={16} />} label="Pack WeebX portal" onClick={pack} />
      </article>
      <article className="portal-card">
        <div className="portal-glyph unpack"><PackageOpen size={22} /></div>
        <h3>Step through</h3>
        <p>Pick an existing portal folder, then a destination. Double-click Launch WeebX.bat when it lands.</p>
        <ul>
          <li>Works from a USB drive, another PC, or a copied folder</li>
          <li>Apache, PHP, and virtual hosts rebase automatically</li>
          <li>Without packed databases, MariaDB starts empty</li>
        </ul>
        <ActionButton working={busy} icon={<PackageOpen size={16} />} label="Unpack portal" onClick={unpack} />
      </article>
    </div>
    {progress && <div className="portal-progress"><div><Sparkles size={16} /><b>{progress.message}</b><span>{progress.completedFiles}/{progress.totalFiles}</span></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div><small>{progress.detail}</small></div>}
    {result && <div className="portal-result"><FolderOpen size={16} /><span>{result}</span></div>}
  </>
}
