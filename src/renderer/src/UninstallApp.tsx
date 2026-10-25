import { useEffect, useRef, useState } from 'react'
import { CircleAlert, Database, FolderOpen, LoaderCircle, Power, Server, ShieldCheck } from 'lucide-react'
import { ActionButton } from './ActionButton'
import logoUrl from './assets/weebx-logo.png'
import { WEEBX_VERSION } from '../../shared/version'
import { isUninstallConfirmation } from './uninstall-confirmation'

function isClosedDuringUninstall(text: string): boolean {
  return /destro|render frame|channel closed|object has been destroyed|no handler|reply was never sent/i.test(text)
}

export function UninstallApp() {
  const [apache, setApache] = useState(false)
  const [mysql, setMysql] = useState(false)
  const [otherWeebx, setOtherWeebx] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [keepHtdocs, setKeepHtdocs] = useState(true)
  const [message, setMessage] = useState('Type UNINSTALL to confirm. Services and other WeebX windows stop first; this uninstaller closes last.')
  const started = useRef(false)
  const confirmed = isUninstallConfirmation(confirmText)

  const refresh = async () => {
    const status = await window.weebx.uninstallStatus()
    setApache(status.apache)
    setMysql(status.mysql)
    setOtherWeebx(status.weebx)
  }

  useEffect(() => {
    document.documentElement.classList.add('uninstall')
    document.title = 'Uninstall WeebX'
    void refresh()
  }, [])

  const uninstall = async () => {
    if (!confirmed || started.current) return false
    started.current = true
    setBusy(true)
    setError(null)
    try {
      setMessage(keepHtdocs ? 'Saving your websites, then stopping services and other WeebX windows...' : 'Stopping services and other WeebX windows...')
      const stopped = await window.weebx.uninstallStop()
      setApache(stopped.apache)
      setMysql(stopped.mysql)
      setOtherWeebx(stopped.weebx)
      if (stopped.apache || stopped.mysql || stopped.weebx) throw new Error('A WeebX service or another WeebX window is still running. Close it and try again.')
      setMessage('Services stopped. Starting Windows Installer; this window will close last...')
      const result = await window.weebx.uninstall({ keepHtdocs })
      setMessage(result.savedTo
        ? `Websites copied to ${result.savedTo}. Windows is now removing WeebX.`
        : 'Windows is now removing WeebX. This window will close.')
    } catch (cause) {
      const text = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(cause)
      if (isClosedDuringUninstall(text)) return true
      started.current = false
      setBusy(false)
      setError(text)
      return false
    }
  }

  return <div className={`uninstall-shell${busy ? ' busy' : ''}`}>
    <div className="title-drag" />
    <img src={logoUrl} alt="WeebX" />
    <span className="eyebrow">DEVELOPMENT TOOL</span>
    <h1>{busy ? 'Uninstalling WeebX' : 'Uninstall WeebX'}</h1>
    <p>{message}</p>
    {busy ? <LoaderCircle className="spin uninstall-spinner" size={36} /> : <>
      <div className="uninstall-status">
        <div><Server size={16} /><span>Apache</span><b className={apache ? 'wait' : 'good'}>{apache ? 'Running' : 'Stopped'}</b></div>
        <div><Database size={16} /><span>MySQL</span><b className={mysql ? 'wait' : 'good'}>{mysql ? 'Running' : 'Stopped'}</b></div>
        <div><Power size={16} /><span>Other WeebX windows</span><b className={otherWeebx ? 'wait' : 'good'}>{otherWeebx ? 'Running' : 'None'}</b></div>
      </div>
      <label className="uninstall-confirm">Type <b>UNINSTALL</b> to confirm
        <input value={confirmText} autoFocus autoComplete="off" spellCheck={false} placeholder="UNINSTALL" onInput={(event) => setConfirmText(event.currentTarget.value)} />
      </label>
      <label className={`uninstall-keep ${keepHtdocs ? 'on' : ''}`}>
        <input type="checkbox" checked={keepHtdocs} onChange={(event) => setKeepHtdocs(event.target.checked)} />
        <span>
          <b>Keep my websites</b>
          Copy htdocs to Documents\WeebX Sites (phpMyAdmin is skipped). AppData is always removed so the next install starts with an empty MySQL password.
        </span>
      </label>
    </>}
    {error && <div className="alert"><CircleAlert size={18} /><span>{error}</span></div>}
    {!busy && <ActionButton className="primary" disabled={!confirmed} working={busy} icon={<Power size={16} />} label="Confirm uninstall" onClick={uninstall} />}
    <p className="note">{keepHtdocs ? 'Sites are copied to Documents\\WeebX Sites, then Windows removes WeebX and the AppData runtime.' : 'Windows removes WeebX and the AppData runtime, including websites in htdocs.'}</p>
    <span className="version">Made by JadaDev - WeebX {WEEBX_VERSION}</span>
    <div className="uninstall-safe"><ShieldCheck size={14} /> Services and other WeebX windows close first; uninstaller closes last{keepHtdocs ? <><FolderOpen size={14} /> Sites kept</> : null}</div>
  </div>
}
