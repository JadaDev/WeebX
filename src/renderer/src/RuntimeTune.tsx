import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LockKeyhole, Puzzle, Save, Search, Server, SlidersHorizontal } from 'lucide-react'
import { ActionButton } from './ActionButton'
import type { PhpLimits, RuntimeModule, RuntimeTune } from '../../shared/types'

type Runner = <T>(operation: () => Promise<T>, after?: boolean) => Promise<T | undefined>

const LIMIT_FIELDS: { key: keyof PhpLimits; label: string; hint: string }[] = [
  { key: 'post_max_size', label: 'POST max size', hint: 'Total POST body, including uploads. Keep this larger than upload max.' },
  { key: 'upload_max_filesize', label: 'Upload max filesize', hint: 'Largest single file PHP will accept.' },
  { key: 'memory_limit', label: 'Memory limit', hint: 'Use 512M, 1G, or -1 for unlimited.' },
  { key: 'max_file_uploads', label: 'Max file uploads', hint: 'How many files one request can send.' },
  { key: 'max_execution_time', label: 'Max execution time', hint: 'Seconds a PHP script may run. 0 means no limit.' },
  { key: 'max_input_time', label: 'Max input time', hint: 'Seconds PHP may spend reading request data.' },
  { key: 'max_input_vars', label: 'Max input variables', hint: 'Raise this for large forms and arrays.' }
]

function PanelTitle({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return <div className="panel-title"><div>{icon}<h3>{title}</h3></div>{action}</div>
}

function ModuleGrid({ modules, query, onToggle }: { modules: RuntimeModule[]; query: string; onToggle: (id: string) => void }) {
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return modules.filter((item) => !needle || item.id.includes(needle) || item.label.toLowerCase().includes(needle) || item.file.toLowerCase().includes(needle))
  }, [modules, query])
  return <div className="module-grid">{filtered.map((item) => (
    <button
      key={item.id}
      type="button"
      title={item.required ? `${item.file} is required by WeebX` : `${item.enabled ? 'Disable' : 'Enable'} ${item.file}`}
      className={`module-chip ${item.enabled ? 'on' : ''} ${item.required ? 'locked' : ''}`}
      disabled={item.required}
      onClick={() => onToggle(item.id)}
    >
      {item.required ? <LockKeyhole size={11} /> : null}
      <span>{item.label}</span>
    </button>
  ))}{!filtered.length && <p className="module-empty">No modules match that filter.</p>}</div>
}

export function RuntimeTunePanel({ phpVersion, run }: { phpVersion: string; run: Runner }) {
  const [tune, setTune] = useState<RuntimeTune | null>(null)
  const [phpQuery, setPhpQuery] = useState('')
  const [apacheQuery, setApacheQuery] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    const next = await window.weebx.getRuntimeTune()
    setTune(next)
    setMessage(null)
  }

  useEffect(() => { void load() }, [phpVersion])

  const toggle = (kind: 'phpExtensions' | 'apacheModules', id: string) => {
    setTune((current) => {
      if (!current) return current
      return {
        ...current,
        [kind]: current[kind].map((item) => item.id === id && !item.required ? { ...item, enabled: !item.enabled } : item)
      }
    })
    setMessage(null)
  }

  const setLimit = (key: keyof PhpLimits, value: string) => {
    setTune((current) => current ? { ...current, phpLimits: { ...current.phpLimits, [key]: value } } : current)
    setMessage(null)
  }

  const save = async () => {
    if (!tune) return false
    const result = await run(() => window.weebx.saveRuntimeTune({
      phpExtensions: Object.fromEntries(tune.phpExtensions.map((item) => [item.id, item.enabled])),
      apacheModules: Object.fromEntries(tune.apacheModules.map((item) => [item.id, item.enabled])),
      phpLimits: tune.phpLimits
    }), false)
    if (!result) return false
    setMessage(result.message)
    await load()
  }

  if (!tune) return <div className="panel runtime-tune"><PanelTitle icon={<SlidersHorizontal size={17} />} title="PHP & Apache configuration" /><p className="tune-loading">Reading php.ini and httpd.conf…</p></div>

  return <div className="runtime-tune">
    <div className="panel setting-block">
      <PanelTitle icon={<SlidersHorizontal size={17} />} title="PHP limits" />
      <p className="tune-copy">Values used by the active PHP {phpVersion} runtime. Raise POST and upload limits for file-transfer sites.</p>
      <div className="limit-grid">{LIMIT_FIELDS.map((field) => (
        <label key={field.key}>{field.label}
          <input value={tune.phpLimits[field.key]} onChange={(event) => setLimit(field.key, event.target.value)} />
          <small>{field.hint}</small>
        </label>
      ))}</div>
    </div>
    <div className="panel setting-block">
      <PanelTitle icon={<Puzzle size={17} />} title="PHP modules" action={<span className="tune-count">{tune.phpExtensions.filter((item) => item.enabled).length} enabled</span>} />
      <p className="tune-copy">Click a module to enable or disable it for the active PHP version. Test extensions are hidden.</p>
      <div className="tune-search"><Search size={14} /><input value={phpQuery} onChange={(event) => setPhpQuery(event.target.value)} placeholder="Filter PHP modules" /></div>
      <ModuleGrid modules={tune.phpExtensions} query={phpQuery} onToggle={(id) => toggle('phpExtensions', id)} />
      <TuneSaveBar message={message} onSave={save} />
    </div>
    <div className="panel setting-block">
      <PanelTitle icon={<Server size={17} />} title="Apache modules" action={<span className="tune-count">{tune.apacheModules.filter((item) => item.enabled).length} enabled</span>} />
      <p className="tune-copy">Required Apache modules stay locked on. Saving validates httpd.conf and restarts Apache when it is running.</p>
      <div className="tune-search"><Search size={14} /><input value={apacheQuery} onChange={(event) => setApacheQuery(event.target.value)} placeholder="Filter Apache modules" /></div>
      <ModuleGrid modules={tune.apacheModules} query={apacheQuery} onToggle={(id) => toggle('apacheModules', id)} />
      <TuneSaveBar message={message} onSave={save} />
    </div>
  </div>
}

function TuneSaveBar({ message, onSave }: { message: string | null; onSave: () => Promise<boolean | void> }) {
  return <div className="tune-save">
    <span className="tune-save-note">{message ?? 'Changes are written to php.ini and httpd.conf.'}</span>
    <ActionButton className="primary tune-save-btn" icon={<Save size={15} />} label="Save and restart Apache" onClick={onSave} />
  </div>
}
