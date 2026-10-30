import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, Boxes, Check, ChevronLeft, ChevronRight, CircleAlert, Code2, Database, Download,
  CircleHelp, ExternalLink, Eye, EyeOff, FileCode2, FolderOpen, Gauge, Globe2, HardDrive, KeyRound, LockKeyhole,
  ListChecks, Orbit, PackageOpen, Play, Plus, Power, RefreshCw, RotateCw, Save, Search, Server, Settings, ShieldCheck,
  Sparkles, Square, Terminal, Trash2, Upload, Wrench, X, Zap
} from 'lucide-react'
import type { DashboardSnapshot, InstallProgress, LogEntry, PermissionPreset, PermissionTarget, PhpRelease, PreinstalledAppActivity, PreinstalledAppCatalogItem, PreinstalledAppConnection, PreinstalledAppInstallRequest, PreinstalledAppPreflight, PreinstalledAppProgress, PreinstalledAppRecord, PublicRuntimeSettings, RuntimeSettings, ServiceId, ServiceStatus, SiteDatabaseCredential, SiteIsolationDraft, SiteLogKind, SiteLogSnapshot, SiteProfileOptions, VhostAccessDraft, VhostDraft, VirtualHost } from '../../shared/types'
import { APACHE_VERSION, MARIADB_VERSION, PHPMYADMIN_VERSION, WEEBX_VERSION } from '../../shared/version'
import logoUrl from './assets/weebx-logo.png'
import { ActionButton } from './ActionButton'
import { RuntimeTunePanel } from './RuntimeTune'
import { PortalPack } from './PortalPack'
import { UninstallApp } from './UninstallApp'
import { AppLogo } from './AppLogo'

type Page = 'dashboard' | 'apps' | 'sites' | 'php' | 'config' | 'logs' | 'portal' | 'settings'
type ConfigKind = 'php' | 'apache' | 'vhosts' | 'mariadb'

const emptySnapshot: DashboardSnapshot = {
  services: [], ports: [], virtualHosts: [], phpVersions: [], stackComponents: [], elevated: false,
  settings: { runtimeRoot: '', htdocsRoot: '', apachePort: 80, apacheSslPort: 443, mariadbPort: 3306, mariadbPasswordSet: false, mariadbPasswordStrength: 'empty', activePhpVersion: '8.5.12', phpProfile: 'development', setupComplete: false, startOnLaunch: false, minimizeToTray: true, checkPortsBeforeStart: true, startWithWindows: false, autoRestartApache: false, autoRestartMariaDb: false, autoRestartDelayMs: 10000 }
}

const nav: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'apps', label: 'Pre-installed apps', icon: PackageOpen },
  { id: 'sites', label: 'Virtual hosts', icon: Globe2 },
  { id: 'php', label: 'PHP versions', icon: Boxes },
  { id: 'config', label: 'Configuration', icon: FileCode2 },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'portal', label: 'Portal packing', icon: Orbit },
  { id: 'settings', label: 'Settings', icon: Settings }
]

export function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [data, setData] = useState<DashboardSnapshot>(emptySnapshot)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [focusPassword, setFocusPassword] = useState(false)
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [hasUnreadLogError, setHasUnreadLogError] = useState(false)
  const pageRef = useRef<Page>('dashboard')

  const refresh = async () => {
    try { setData(await window.weebx.snapshot()); setLogs(await window.weebx.logs()); setError(null) }
    catch (cause) { setError(messageOf(cause)) }
  }

  useEffect(() => {
    const started = Date.now()
    const boot = async () => {
      await refresh()
      const wait = 900 - (Date.now() - started)
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      setLoading(false)
    }
    void boot()
    const offLog = window.weebx.onLog((entry) => {
      setLogs((items) => [...items.slice(-999), entry])
      if (entry.level === 'error' && pageRef.current !== 'logs') setHasUnreadLogError(true)
    })
    const offStatus = window.weebx.onStatus((status) => setData((old) => ({ ...old, services: old.services.map((item) => item.id === status.id ? status : item) })))
    const offProgress = window.weebx.onInstallProgress(setProgress)
    const offUninstall = window.weebx.onOpenUninstall(() => {
      document.documentElement.classList.add('uninstall')
      document.title = 'Uninstall WeebX'
      setUninstallOpen(true)
    })
    return () => { offLog(); offStatus(); offProgress(); offUninstall() }
  }, [])

  useEffect(() => {
    pageRef.current = page
    if (page === 'logs') setHasUnreadLogError(false)
  }, [page])

  const run = async <T,>(operation: () => Promise<T>, after = true): Promise<T | undefined> => {
    try { const value = await operation(); setError(null); if (after) await refresh(); return value }
    catch (cause) { if (after) await refresh(); setError(messageOf(cause)); return undefined }
  }

  const content: Record<Page, ReactNode> = {
    dashboard: <Dashboard data={data} logs={logs} run={run} onChangePassword={() => { setFocusPassword(true); setPage('settings') }} />,
    apps: <PreinstalledApps data={data} run={run} />,
    sites: <Sites data={data} run={run} />,
    php: <PhpManager data={data} progress={progress} run={run} />,
    config: <ConfigEditor run={run} />,
    logs: <Logs entries={logs} />,
    portal: <PortalPack run={run} />,
    settings: <SettingsPage settings={data.settings} elevated={data.elevated} mariaDbRunning={data.services.some((item) => item.id === 'mariadb' && item.state === 'running')} run={run} focusPassword={focusPassword} onFocusedPassword={() => setFocusPassword(false)} />
  }

  if (uninstallOpen) return <UninstallApp />
  if (loading) return <div className="splash"><div className="title-drag" /><div className="splash-mark"><i className="splash-ring" /><Logo /></div></div>
  return <div className="shell">
    <div className="title-drag" />
    <aside>
      <button type="button" className="brand" title="Open weebx.jadadev.com" onClick={() => void window.weebx.openExternal('https://weebx.jadadev.com/')}><Logo /><div><strong>WeebX</strong><span>Hosting Stack Manager</span></div></button>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={18} /><span>{label}</span>{id === 'logs' && hasUnreadLogError && <i />}</button>)}</nav>
      <div className="sidebar-foot">
        <div className={`health ${data.services.every((item) => item.state === 'running') ? 'ok' : ''}`}><Activity size={16} /><div><b>{data.services.filter((item) => item.state === 'running').length}/{data.services.length} services</b><span>{data.services.some((item) => item.state === 'error') ? 'Attention needed' : 'System ready'}</span></div></div>
        <span className="version">Made by JadaDev - WeebX {WEEBX_VERSION}</span>
      </div>
    </aside>
    <main>
      <header><div><p>LOCAL WEB HOSTING STACK MANAGER</p><h1>{nav.find((item) => item.id === page)?.label}</h1></div><div className="header-actions"><ActionButton className="icon-btn" title="Refresh" icon={<RefreshCw size={17} />} onClick={() => refresh()} /><AdminBadge elevated={data.elevated} onRestart={() => run(() => window.weebx.restartAsAdministrator(), false)} /></div></header>
      {error && <div className="alert"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError(null)}><X size={16} /></button></div>}
      <section className={`page${page === 'config' || page === 'logs' ? ' fill' : ''}`}>{content[page]}</section>
    </main>
    {!data.settings.setupComplete && <SecuritySetup run={run} error={error} />}
  </div>
}

function Dashboard({ data, logs, run, onChangePassword }: { data: DashboardSnapshot; logs: LogEntry[]; run: Runner; onChangePassword: () => void }) {
  const [heroBusy, setHeroBusy] = useState<'start' | 'stop' | null>(null)
  const running = data.services.filter((item) => item.state === 'running').length
  const allRunning = data.services.length > 0 && running === data.services.length
  const anyRunning = running > 0
  const port = data.settings.apachePort || 80
  const phpMyAdminUrl = `http://127.0.0.1:${port}/phpmyadmin/`
  const websiteUrl = port === 80 ? 'http://localhost/' : `http://localhost:${port}/`
  const runStack = async (action: 'start' | 'stop') => {
    setHeroBusy(action)
    try { return (await run(() => window.weebx.serviceAll(action))) !== undefined }
    finally { setHeroBusy(null) }
  }
  return <>
    <div className="hero"><div><span className="eyebrow"><Zap size={14} /> HOSTING CONTROL PLANE</span><h2>Local Web Hosting<br /><em>Stack Manager.</em></h2><p>Run Apache, MariaDB and multiple PHP versions from one quiet control plane.</p><div className="hero-actions"><ActionButton className="primary" disabled={allRunning || heroBusy === 'stop'} working={heroBusy === 'start'} icon={<Play size={16} fill="currentColor" />} label="Start all" onClick={() => runStack('start')} /><ActionButton disabled={!anyRunning || heroBusy === 'start'} working={heroBusy === 'stop'} icon={<Square size={15} fill="currentColor" />} label="Stop all" onClick={() => runStack('stop')} /></div></div><ServiceOrbit running={running} total={data.services.length} /></div>
    {(() => { const status = passwordSecurityStatus(data.settings); return status.tone === 'secure' ? <div className="security-nudge secure-state"><ShieldCheck size={14} /><span>MariaDB password: Secure status ({data.settings.phpProfile === 'production' ? 'Live / Production' : 'Development'}).</span></div> : <button type="button" className={`security-nudge ${status.tone}`} onClick={onChangePassword}><CircleAlert size={14} /><span>MariaDB password: {status.label}. {status.message}</span><ChevronRight size={14} /></button> })()}
    {data.settings.phpProfile === 'development' && <div className="security-nudge environment-nudge"><CircleAlert size={14} /><span>Development mode can display application errors. Switch PHP to Live / Production before exposing websites publicly.</span></div>}
    <div className="section-title"><div><h3>Services</h3><p>Processes managed by WeebX</p></div></div>
    <div className="service-grid">{data.services.map((service) => <ServiceCard key={service.id} service={service} settings={data.settings} phpMyAdminUrl={phpMyAdminUrl} websiteUrl={websiteUrl} run={run} onChangePassword={onChangePassword} />)}</div>
    <div className="dashboard-grid"><div className="panel"><PanelTitle icon={<HardDrive size={17} />} title="Port health" action={<ActionButton className="text-btn scan-btn" icon={<RefreshCw size={12} />} label="Scan again" onClick={async () => (await run(() => window.weebx.ports())) !== undefined} />} /><div className="port-list">{data.ports.map((port) => <div key={port.port}><span className={port.available ? 'dot free' : 'dot busy'} /><b>:{port.port}</b><span>{port.available ? 'Available' : port.processName || 'In use'}</span>{port.pid && <code>PID {port.pid}</code>}</div>)}</div></div>
      <div className="panel"><PanelTitle icon={<Terminal size={17} />} title="Recent activity" /><div className="mini-logs">{logs.slice(-80).reverse().map((entry) => <div key={entry.id} title={entry.message}><span>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><i className={entry.level} /> <p>{entry.message}</p></div>)}{!logs.length && <Empty text="No activity yet" />}</div></div></div>
  </>
}

function ServiceOrbit({ running, total }: { running: number; total: number }) {
  const nodes = (path: 'a' | 'b', duration: number, colors: string[]) => colors.map((color, index) => <circle key={`${path}-${index}`} className={`orbit-node ${index === 0 ? 'primary' : ''}`} r={index === 0 ? 4.2 : index === 1 ? 3 : 2.2} fill={color}>
    <animateMotion dur={`${duration}s`} begin={`${-(duration / colors.length) * index}s`} repeatCount="indefinite" calcMode="linear"><mpath href={`#service-orbit-${path}`} /></animateMotion>
  </circle>)
  return <div className={`hero-orbit count-${running}`} aria-label={`${running} of ${total} services running`}>
    {running > 0 && <svg className="orbit-map" viewBox="0 0 280 190" aria-hidden="true">
      <defs>
        <linearGradient id="service-orbit-purple" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7567f7" stopOpacity=".12" /><stop offset=".5" stopColor="#a99eff" stopOpacity=".52" /><stop offset="1" stopColor="#695ce8" stopOpacity=".08" /></linearGradient>
        <linearGradient id="service-orbit-cyan" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#55dff4" stopOpacity=".08" /><stop offset=".52" stopColor="#71e8fa" stopOpacity=".46" /><stop offset="1" stopColor="#8274ff" stopOpacity=".12" /></linearGradient>
        <filter id="service-node-glow" x="-400%" y="-400%" width="800%" height="800%"><feGaussianBlur stdDeviation="3.2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <path id="service-orbit-a" className="orbit-track track-a" d="M 27 95 a 113 49 0 1 0 226 0 a 113 49 0 1 0 -226 0" transform="rotate(-12 140 95)" />
      {nodes('a', 6.8, ['#d9d4ff', '#9f94ff', '#7567f7', '#baafff'])}
      {running >= 2 && <>
        <path id="service-orbit-b" className="orbit-track track-b" d="M 82 95 a 58 98 0 1 0 116 0 a 58 98 0 1 0 -116 0" transform="rotate(28 140 95)" />
        {nodes('b', 9.4, ['#bdf8ff', '#66e0f4', '#7b78ff', '#80f0dd'])}
      </>}
    </svg>}
    <div className="orb"><span>{running}</span><small>{running === 0 ? 'IDLE' : 'RUNNING'}</small><em>{running}/{total}</em></div>
  </div>
}

function ServiceCard({ service, settings, phpMyAdminUrl, websiteUrl, run, onChangePassword }: { service: ServiceStatus; settings: PublicRuntimeSettings; phpMyAdminUrl: string; websiteUrl: string; run: Runner; onChangePassword: () => void }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (service.state !== 'running' || !service.startedAt) return
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [service.state, service.startedAt])
  const busy = service.state === 'starting' || service.state === 'stopping'
  const running = service.state === 'running'
  const Icon = service.id === 'apache' ? Server : Database
  const autoRestart = service.id === 'apache' ? settings.autoRestartApache : settings.autoRestartMariaDb
  const toggleRecovery = async () => {
    const patch: Partial<RuntimeSettings> = service.id === 'apache'
      ? { autoRestartApache: !autoRestart }
      : { autoRestartMariaDb: !autoRestart }
    return (await run(() => window.weebx.updateSettings(patch))) !== undefined
  }
  return <article className={`service-card ${service.state}`}>
    <div className="service-top"><div className="service-icon"><Icon size={24} /></div><span className={`state ${service.state}`}><i />{service.state}</span></div>
    <h3>{service.id === 'mariadb' ? 'MariaDB' : service.name}</h3>
    <p>{service.id === 'apache' ? 'HTTP & HTTPS web server' : `MariaDB ${service.version || MARIADB_VERSION}`}</p>
    <div className="metrics"><div><span>PORT</span><b>{service.port}</b></div><div><span>PID</span><b>{service.pid ?? '—'}</b></div><div><span>UPTIME</span><b>{service.startedAt && running ? formatUptime(service.startedAt) : '—'}</b></div></div>
    {service.message && <div className="service-message">{service.message}</div>}
    <div className={`recovery-control ${autoRestart ? 'on' : ''}`}>
      <div><RefreshCw size={14} /><span><b>Crash recovery</b><small>Retry after {formatRestartDelay(settings.autoRestartDelayMs)}</small></span></div>
      <button type="button" role="switch" aria-label={`Automatic restart for ${service.name}`} aria-checked={autoRestart} className={autoRestart ? 'on' : ''} onClick={() => void toggleRecovery()}><i /></button>
    </div>
    {service.id === 'apache' && <div className="service-links"><ActionButton icon={<FolderOpen size={14} />} label="htdocs" onClick={async () => (await run(() => window.weebx.openPath(settings.htdocsRoot), false)) !== undefined} /><ActionButton icon={<Globe2 size={14} />} label="Website" onClick={async () => (await run(() => window.weebx.openExternal(websiteUrl), false)) !== undefined} /><ActionButton icon={<ExternalLink size={14} />} label="phpMyAdmin" onClick={async () => (await run(() => window.weebx.openExternal(phpMyAdminUrl), false)) !== undefined} /></div>}
    {service.id === 'mariadb' && <div className="service-links"><ActionButton icon={<KeyRound size={14} />} label="Change Password" onClick={onChangePassword} /></div>}
    <div className="service-actions"><ActionButton disabled={busy} working={busy} className={running ? 'danger-soft' : 'start'} icon={running ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />} label={running ? 'Stop' : 'Start'} onClick={async () => (await run(() => window.weebx.service(running ? 'stop' : 'start', service.id))) !== undefined} /><ActionButton title="Restart" disabled={!running || busy} working={busy && running} icon={<RotateCw size={15} />} onClick={async () => (await run(() => window.weebx.service('restart', service.id))) !== undefined} /></div>
  </article>
}

function defaultSiteIsolation(version: string, name = 'site'): SiteIsolationDraft {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'site'
  return {
    phpVersion: version, phpProfile: 'development',
    phpExtensions: ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'sodium', 'zip'],
    memoryLimit: '256M', maxExecutionTime: 120, maxInputTime: 60, maxInputVars: 3000,
    uploadMaxFilesize: '64M', postMaxSize: '64M', maxFileUploads: 20,
    openBasedir: true, disableDangerousFunctions: false, allowUserIni: false,
    permissionPreset: 'private', customIni: '',
    database: undefined
  }
}

function editableIsolation(site: VirtualHost, fallbackVersion: string): SiteIsolationDraft {
  if (!site.isolation) return defaultSiteIsolation(fallbackVersion, site.name)
  return { ...site.isolation, phpExtensions: [...site.isolation.phpExtensions], database: site.isolation.database ? { ...site.isolation.database, password: '' } : undefined }
}

function Sites({ data, run }: { data: DashboardSnapshot; run: Runner }) {
  const [show, setShow] = useState(false)
  const [help, setHelp] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<VirtualHost | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [editIsolation, setEditIsolation] = useState<SiteIsolationDraft | undefined>()
  const [options, setOptions] = useState<SiteProfileOptions | null>(null)
  const [credential, setCredential] = useState<SiteDatabaseCredential | null>(null)
  const [siteLog, setSiteLog] = useState<SiteLogSnapshot | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editAccess, setEditAccess] = useState<VhostAccessDraft>({ http: true, https: false })
  const [draft, setDraft] = useState<VhostDraft>(() => ({ name: '', serverName: '', aliases: [], http: true, https: false, forceHttps: false, updateHosts: false, isolation: defaultSiteIsolation(data.settings.activePhpVersion) }))
  const loadOptions = async (version: string, applyRecommended = false) => {
    const next = await run(() => window.weebx.siteProfileOptions(version), false)
    if (!next) return
    setOptions(next)
    const update = (profile: SiteIsolationDraft | undefined) => profile ? { ...profile, phpVersion: version, phpExtensions: applyRecommended ? next.recommendedExtensions : profile.phpExtensions.filter((item) => next.extensions.includes(item)) } : profile
    if (editing) setEditIsolation((old) => update(old))
    else setDraft((old) => ({ ...old, isolation: update(old.isolation) }))
  }
  useEffect(() => {
    const profile = editing ? editIsolation : show ? draft.isolation : undefined
    if (profile) void loadOptions(profile.phpVersion)
  }, [show, editing?.id])
  useEffect(() => {
    if (!credential) return
    const timeout = window.setTimeout(() => setCredential(null), 30000)
    const hide = () => setCredential(null)
    window.addEventListener('blur', hide)
    return () => { window.clearTimeout(timeout); window.removeEventListener('blur', hide) }
  }, [credential])
  const openCreate = () => {
    setDraft({ name: '', serverName: '', aliases: [], http: true, https: false, forceHttps: false, updateHosts: false, isolation: defaultSiteIsolation(data.settings.activePhpVersion) })
    setOptions(null); setCreateError(null); setShow(true)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setCreating(true); setCreateError(null)
    try {
      await window.weebx.createVhost(draft)
      await run(async () => true)
      setShow(false); setHelp(false)
    } catch (cause) {
      setCreateError(messageOf(cause))
    } finally { setCreating(false) }
  }
  const openProfile = (site: VirtualHost) => {
    setEditing(site)
    setEditIsolation(editableIsolation(site, data.settings.activePhpVersion))
    setEditAccess({ http: site.http, https: site.https, forceHttps: site.forceHttps === true, updateHosts: Boolean(site.managedHosts?.length) })
    setCredential(null); setSiteLog(null); setOptions(null)
  }
  const saveProfile = async () => {
    if (!editing) return
    setSavingProfile(true)
    try {
      const access = await run(() => window.weebx.updateVhostAccess(editing.id, editAccess))
      if (!access) return
      if (await run(() => window.weebx.updateVhostProfile(editing.id, editIsolation))) { setEditing(null); setCredential(null) }
    }
    finally { setSavingProfile(false) }
  }
  const revealCredential = async () => {
    if (!editing) return
    const result = await run(() => window.weebx.revealSiteDatabasePassword(editing.id), false)
    if (result) setCredential(result)
  }
  const readSiteLog = async (kind: SiteLogKind) => {
    if (!editing) return
    const result = await run(() => window.weebx.readSiteLog(editing.id, kind), false)
    if (result) setSiteLog(result)
  }
  return <><div className="page-toolbar"><div><h2>Virtual hosts</h2><p>Run simple sites or give each project its own PHP, storage, logs, database identity, and security policy.</p></div><ActionButton className="primary" icon={<Plus size={16} />} label="New site" onClick={openCreate} /></div>
    <div className="site-list">{data.virtualHosts.map((site) => <article key={site.id} className={site.isolation ? 'isolated' : ''}><div className="site-glyph">{site.isolation ? <ShieldCheck size={20} /> : <Globe2 size={20} />}</div><div className="site-main"><div><h3>{site.serverName}</h3><span className={site.enabled ? 'enabled' : 'disabled'}>{site.enabled ? 'Enabled' : 'Disabled'}</span>{site.isolation && <span className="isolation-badge">Isolated</span>}{site.isolation?.database && !site.isolation.database.passwordSet && <span className="credential-repair">Credential setup required</span>}</div><p>{site.documentRoot}</p><div className="tags">{site.http && <span>HTTP</span>}{site.https && <span><LockKeyhole size={11} /> HTTPS</span>}{site.isolation && <span>PHP {site.isolation.phpVersion}</span>}{site.isolation?.database && <span><Database size={11} /> {site.isolation.database.databaseName}</span>}{site.aliases.map((alias) => <span key={alias}>{alias}</span>)}</div></div><div className="row-actions"><ActionButton title="Edit DNS host, HTTPS, and isolation" icon={<Wrench size={17} />} onClick={() => openProfile(site)} /><ActionButton title="Open folder" icon={<FolderOpen size={17} />} onClick={async () => (await run(() => window.weebx.openPath(site.documentRoot), false)) !== undefined} /><ActionButton title={site.enabled ? 'Disable' : 'Enable'} icon={<Power size={17} />} onClick={async () => (await run(() => window.weebx.setVhostEnabled(site.id, !site.enabled))) !== undefined} /><ActionButton className="trash" title="Remove (files and database are preserved)" icon={<Trash2 size={17} />} onClick={async () => { if (!confirm(`Remove ${site.serverName}? Project files and its database will be preserved; the managed database login will be removed.`)) return false; return (await run(() => window.weebx.deleteVhost(site.id))) !== undefined }} /></div></article>)}{!data.virtualHosts.length && <div className="big-empty"><ShieldCheck size={30} /><h3>No sites yet</h3><p>Create an isolated project with its own runtime policy and database identity.</p><ActionButton icon={<Plus size={16} />} label="Create your first site" onClick={openCreate} /></div>}</div>
    {show && <Modal wide title="Create virtual host" onClose={() => { setShow(false); setHelp(false) }}><form className="form site-form" onSubmit={(event) => void submit(event)}><div className="site-basics">
      <label><FieldHint text="Project name (folder)" tip="Folder WeebX creates inside htdocs." /><input required placeholder="customer-portal" value={draft.name} onChange={(e) => { const name = e.target.value; setDraft((old) => ({ ...old, name, isolation: old.isolation ? { ...old.isolation, database: old.isolation.database ? { ...old.isolation.database, databaseName: `${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_db`.slice(0, 63), username: `${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_app`.slice(0, 32) } : undefined } : undefined })) }} /></label>
      <label><FieldHint text="Server name" tip="Use a .localhost DNS host (no Administrator) or any hostname mapped in Windows hosts." /><input required placeholder="portal.localhost" value={draft.serverName} onChange={(e) => { const serverName = e.target.value; setDraft({ ...draft, serverName, updateHosts: automaticLocalhost(serverName) ? false : draft.updateHosts }) }} /></label>
      <label><FieldHint text="Aliases" tip="Optional comma-separated hostnames." /><input placeholder="www.portal.localhost" value={draft.aliases.join(', ')} onChange={(e) => setDraft({ ...draft, aliases: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label>
      <SiteAccessControls http={draft.http} https={draft.https} forceHttps={draft.forceHttps} updateHosts={draft.updateHosts} showHosts={!automaticLocalhost(draft.serverName)} automaticDns={automaticLocalhost(draft.serverName)} domain={draft.serverName} onChange={(patch) => setDraft({ ...draft, ...patch, forceHttps: patch.https === false || patch.http === false ? false : (patch.forceHttps ?? draft.forceHttps) })} />
    </div><div className="isolation-switch"><div><ShieldCheck size={20} /><span><b>Isolated site profile</b><small>Separate PHP configuration, writable storage, logs, database identity, and permission policy.</small></span></div><Toggle checked={Boolean(draft.isolation)} onChange={(enabled) => setDraft({ ...draft, isolation: enabled ? defaultSiteIsolation(data.settings.activePhpVersion, draft.name) : undefined })} label={draft.isolation ? 'Enabled' : 'Disabled'} /></div>
      {draft.isolation && <SiteProfileEditor profile={draft.isolation} options={options} versions={data.phpVersions.filter((item) => item.installed).map((item) => item.version)} profileRoot={`${data.settings.runtimeRoot}\\site-profiles\\${draft.name || 'project-name'}`} mariaDbRunning={data.services.some((item) => item.id === 'mariadb' && item.state === 'running')} onVersion={(version) => void loadOptions(version, true)} onChange={(isolation) => setDraft({ ...draft, isolation })} />}
      {draft.updateHosts && !data.elevated && <div className="modal-admin-note"><CircleAlert size={15} /><span><b>Administrator mode may be required</b><small>Windows requires approval if this local domain is not already in the hosts file.</small></span><ActionButton icon={<ShieldCheck size={13} />} label="Restart as administrator" onClick={() => window.weebx.restartAsAdministrator().catch((cause) => setCreateError(messageOf(cause)))} /></div>}
      {createError && <div className="wizard-error" role="alert"><CircleAlert size={15} /><span>{createError}</span><button type="button" aria-label="Dismiss error" onClick={() => setCreateError(null)}><X size={14} /></button></div>}
      <div className="modal-actions"><button type="button" onClick={() => setHelp(true)}><CircleHelp size={15} /> Help</button><div className="modal-actions-end"><button type="button" onClick={() => setShow(false)}>Cancel</button><ActionButton className="primary" type="submit" working={creating} icon={<Plus size={16} />} label="Create site" /></div></div>
    </form></Modal>}
    {editing && <Modal wide title={`Site · ${editing.serverName}`} onClose={() => { setEditing(null); setCredential(null) }}><div className="form site-form"><div className="site-access-card"><div><Globe2 size={18} /><span><b>Local DNS host</b><small>{automaticLocalhost(editing.serverName) ? `${editing.serverName} resolves automatically. Change HTTP/HTTPS here without editing the Windows hosts file.` : `This name is a local DNS host. WeebX can map it in Windows hosts, or you can edit C:\\Windows\\System32\\drivers\\etc\\hosts (look for BEGIN WEEBX HOST).`}</small></span></div><SiteAccessControls http={editAccess.http} https={editAccess.https} forceHttps={editAccess.forceHttps} updateHosts={editAccess.updateHosts} showHosts={!automaticLocalhost(editing.serverName)} automaticDns={automaticLocalhost(editing.serverName)} domain={editing.serverName} onChange={(patch) => setEditAccess((old) => ({ ...old, ...patch, forceHttps: patch.https === false || patch.http === false ? false : (patch.forceHttps ?? old.forceHttps) }))} /></div><div className="isolation-switch"><div>{editIsolation ? <ShieldCheck size={20} /> : <CircleAlert size={20} />}<span><b>{editIsolation ? 'Isolated profile enabled' : 'Standard shared profile'}</b><small>{editIsolation ? 'This site has dedicated PHP settings and runtime storage.' : 'This site currently inherits the global PHP runtime.'}</small></span></div><Toggle checked={Boolean(editIsolation)} onChange={(enabled) => setEditIsolation(enabled ? editableIsolation(editing, data.settings.activePhpVersion) : undefined)} label={editIsolation ? 'Enabled' : 'Disabled'} /></div>
      {editIsolation && <SiteProfileEditor profile={editIsolation} options={options} versions={data.phpVersions.filter((item) => item.installed).map((item) => item.version)} profileRoot={`${data.settings.runtimeRoot}\\site-profiles\\${editing.name}`} mariaDbRunning={data.services.some((item) => item.id === 'mariadb' && item.state === 'running')} onVersion={(version) => void loadOptions(version, true)} onChange={setEditIsolation} credential={credential} onRevealCredential={editing.isolation?.database ? revealCredential : undefined} siteLog={siteLog} onReadLog={readSiteLog} />}
      <div className="modal-actions">{editing.isolation && <ActionButton icon={<FolderOpen size={14} />} label="Profile storage" onClick={async () => (await run(() => window.weebx.openPath(`${data.settings.runtimeRoot}\\site-profiles\\${editing.name}`), false)) !== undefined} />}<span className="isolation-footnote">Disabling isolation preserves the site files and database but removes its managed database login.</span><div className="modal-actions-end"><button type="button" onClick={() => setEditing(null)}>Cancel</button><ActionButton className="primary" working={savingProfile} icon={<Save size={15} />} label="Save site" onClick={saveProfile} /></div></div>
    </div></Modal>}
    {help && <Modal title="How isolated sites work" onClose={() => setHelp(false)}><div className="help-copy"><p>Each isolated site uses its selected PHP executable with a dedicated <code>php.ini</code>, session folder, temporary directories, upload staging area, and log files.</p><p><b>Filesystem boundary:</b> open_basedir limits PHP file access to the site and profile folders. It is defense in depth, not a replacement for a separate Windows account or virtual machine.</p><p><b>Database identity:</b> WeebX creates a strong-password user limited to this database. The root account is never written into the site.</p><p><b>Live hosting:</b> select Live / Production, keep user-level INI overrides disabled, use HTTPS, and test the application before exposure.</p></div><div className="modal-actions"><button className="primary" type="button" onClick={() => setHelp(false)}>Got it</button></div></Modal>}
  </>
}

function SiteProfileEditor({ profile, options, versions, profileRoot, mariaDbRunning, onVersion, onChange, credential, onRevealCredential, siteLog, onReadLog }: { profile: SiteIsolationDraft; options: SiteProfileOptions | null; versions: string[]; profileRoot: string; mariaDbRunning: boolean; onVersion: (version: string) => void; onChange: (profile: SiteIsolationDraft) => void; credential?: SiteDatabaseCredential | null; onRevealCredential?: () => void; siteLog?: SiteLogSnapshot | null; onReadLog?: (kind: SiteLogKind) => void }) {
  const [tab, setTab] = useState<'runtime' | 'limits' | 'database' | 'security' | 'ini' | 'logs'>('runtime')
  const [extensionSearch, setExtensionSearch] = useState('')
  const extensions = (options?.extensions ?? profile.phpExtensions).filter((item) => item.includes(extensionSearch.toLowerCase()))
  const set = <K extends keyof SiteIsolationDraft>(key: K, value: SiteIsolationDraft[K]) => onChange({ ...profile, [key]: value })
  const toggleExtension = (name: string) => set('phpExtensions', profile.phpExtensions.includes(name) ? profile.phpExtensions.filter((item) => item !== name) : [...profile.phpExtensions, name].sort())
  const enableDatabase = (enabled: boolean) => set('database', enabled ? { databaseName: 'site_db', username: 'site_app', access: 'read-write', password: browserStrongPassword() } : undefined)
  const regenerateDatabasePassword = () => profile.database && set('database', { ...profile.database, password: browserStrongPassword() })
  return <div className="profile-editor"><div className="profile-summary"><div><Code2 size={16} /><span><small>PHP</small><b>{profile.phpVersion} · {profile.phpProfile === 'production' ? 'Live / Production' : 'Development'}</b></span></div><div><HardDrive size={16} /><span><small>Profile storage</small><b title={profileRoot}>{profileRoot}</b></span></div><div><Database size={16} /><span><small>Database identity</small><b>{profile.database ? profile.database.username : 'Not provisioned'}</b></span></div></div>
    <div className="profile-tabs">{([['runtime', 'PHP runtime'], ['limits', 'Limits & uploads'], ['database', 'Database'], ['security', 'Security'], ['ini', 'Advanced php.ini'], ...(onReadLog ? [['logs', 'Site logs'] as const] : [])] as const).map(([id, label]) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); if (id === 'logs' && !siteLog) onReadLog?.('php') }}>{label}</button>)}</div>
    <div className="profile-pane">
      {tab === 'runtime' && <><div className="profile-grid"><label>PHP version<select value={profile.phpVersion} onChange={(event) => onVersion(event.target.value)}>{versions.map((version) => <option key={version}>{version}</option>)}</select></label><label>Environment<select value={profile.phpProfile} onChange={(event) => set('phpProfile', event.target.value as SiteIsolationDraft['phpProfile'])}><option value="development">Development</option><option value="production">Live / Production</option></select></label></div><div className="extension-toolbar"><label><span>PHP extensions</span><input placeholder="Search extensions" value={extensionSearch} onChange={(event) => setExtensionSearch(event.target.value)} /></label><span>{profile.phpExtensions.length} enabled</span></div><div className="profile-extensions">{extensions.map((name) => <button type="button" key={name} className={profile.phpExtensions.includes(name) ? 'on' : ''} onClick={() => toggleExtension(name)}><i>{profile.phpExtensions.includes(name) ? <Check size={11} /> : <Plus size={11} />}</i>{name}</button>)}</div></>}
      {tab === 'limits' && <><div className="profile-grid limits"><label>Memory limit<input value={profile.memoryLimit} onChange={(e) => set('memoryLimit', e.target.value)} /></label><label>Execution time (seconds)<input type="number" min="1" max="3600" value={profile.maxExecutionTime} onChange={(e) => set('maxExecutionTime', Number(e.target.value))} /></label><label>Input time (seconds)<input type="number" min="1" max="3600" value={profile.maxInputTime} onChange={(e) => set('maxInputTime', Number(e.target.value))} /></label><label>Input variables<input type="number" min="100" max="100000" value={profile.maxInputVars} onChange={(e) => set('maxInputVars', Number(e.target.value))} /></label><label>Maximum upload<input value={profile.uploadMaxFilesize} onChange={(e) => set('uploadMaxFilesize', e.target.value)} /></label><label>Maximum POST body<input value={profile.postMaxSize} onChange={(e) => set('postMaxSize', e.target.value)} /></label><label>Files per request<input type="number" min="1" max="200" value={profile.maxFileUploads} onChange={(e) => set('maxFileUploads', Number(e.target.value))} /></label></div><p className="profile-note">Uploads are staged outside the public document root in this profile’s private upload directory.</p></>}
      {tab === 'database' && <><div className="database-switch"><div><Database size={18} /><span><b>Managed least-privilege database user</b><small>Scoped to one database; never grants global or grant-option privileges.</small></span></div><Toggle checked={Boolean(profile.database)} onChange={enableDatabase} label={profile.database ? 'Enabled' : 'Disabled'} /></div>{profile.database && <div className="profile-grid database-fields"><label>Database name<input value={profile.database.databaseName} onChange={(e) => set('database', { ...profile.database!, databaseName: e.target.value })} /></label><label>Username<input value={profile.database.username} onChange={(e) => set('database', { ...profile.database!, username: e.target.value })} /></label><label>Access<select value={profile.database.access} onChange={(e) => set('database', { ...profile.database!, access: e.target.value as 'read-write' | 'read-only' })}><option value="read-write">Read and write</option><option value="read-only">Read only</option></select></label><div className="database-password"><span>Password</span><div>{credential ? <code>{credential.password}</code> : profile.database.password ? <code>{profile.database.password}</code> : <code>Protected · unchanged</code>}<button type="button" onClick={regenerateDatabasePassword}><RefreshCw size={12} /> Generate new</button>{onRevealCredential && <button type="button" onClick={onRevealCredential}><Eye size={12} /> Reveal saved</button>}</div></div></div>}<p className={`profile-note ${!mariaDbRunning && profile.database ? 'warn' : ''}`}>{mariaDbRunning ? 'MariaDB is ready to provision or update this identity.' : 'Start MariaDB before saving a profile with a managed database user.'}</p></>}
      {tab === 'security' && <><div className="security-options"><Toggle checked={profile.openBasedir} onChange={(value) => set('openBasedir', value)} label="Restrict PHP filesystem access to this site and its profile storage" /><Toggle checked={profile.disableDangerousFunctions} onChange={(value) => set('disableDangerousFunctions', value)} label="Disable process-execution functions (exec, shell_exec, system, proc_open, popen)" /><Toggle checked={profile.allowUserIni} onChange={(value) => set('allowUserIni', value)} label="Allow application .user.ini overrides (advanced; off is safer)" /></div><label className="permission-select">NTFS permission policy<select value={profile.permissionPreset} onChange={(e) => set('permissionPreset', e.target.value as PermissionPreset)}><option value="private">Private — current Windows account, SYSTEM, administrators</option><option value="writable">Owner writable — inherited Windows permissions</option><option value="windows-default">Windows inherited defaults</option></select></label><p className="profile-note">Apache and PHP still run under the same Windows account. For hostile multi-tenant code, use separate Windows accounts, containers, or virtual machines.</p></>}
      {tab === 'ini' && <><label className="custom-ini">Additional php.ini directives<textarea spellCheck={false} placeholder={"realpath_cache_size=4096K\nopcache.memory_consumption=192"} value={profile.customIni} onChange={(e) => set('customIni', e.target.value)} /></label><p className="profile-note">One <code>key=value</code> directive per line. Isolation, credentials, extensions, paths, logging, and upload limits remain protected and cannot be overridden here.</p></>}
      {tab === 'logs' && onReadLog && <><div className="site-log-toolbar"><div><button type="button" className={siteLog?.kind === 'php' ? 'active' : ''} onClick={() => onReadLog('php')}>PHP errors</button><button type="button" className={siteLog?.kind === 'apache-error' ? 'active' : ''} onClick={() => onReadLog('apache-error')}>Apache errors</button><button type="button" className={siteLog?.kind === 'apache-access' ? 'active' : ''} onClick={() => onReadLog('apache-access')}>Access log</button></div><button type="button" onClick={() => onReadLog(siteLog?.kind ?? 'php')}><RefreshCw size={12} /> Refresh</button></div><div className="site-log-path">{siteLog?.path ?? `${profileRoot}\\logs`}{siteLog?.truncated && <span>Showing latest 750 KB</span>}</div><pre className="site-log-view">{siteLog?.content || 'No entries yet.'}</pre></>}
    </div>
  </div>
}

type AppsView = 'catalog' | 'installed' | 'activity'

function PreinstalledApps({ data, run }: { data: DashboardSnapshot; run: Runner }) {
  const [view, setView] = useState<AppsView>('catalog')
  const [catalog, setCatalog] = useState<PreinstalledAppCatalogItem[]>([])
  const [installed, setInstalled] = useState<PreinstalledAppRecord[]>([])
  const [activity, setActivity] = useState<PreinstalledAppActivity[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState<PreinstalledAppCatalogItem | null>(null)
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<PreinstalledAppInstallRequest | null>(null)
  const [profileOptions, setProfileOptions] = useState<SiteProfileOptions | null>(null)
  const [progress, setProgress] = useState<PreinstalledAppProgress | null>(null)
  const [installing, setInstalling] = useState(false)
  const [completed, setCompleted] = useState<PreinstalledAppRecord | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PreinstalledAppRecord | null>(null)
  const [removeChoices, setRemoveChoices] = useState({ removeFiles: true, removeDatabase: true, removeSite: true })
  const [removing, setRemoving] = useState(false)
  const [credential, setCredential] = useState<PreinstalledAppConnection | null>(null)
  const [preflight, setPreflight] = useState<PreinstalledAppPreflight | null>(null)
  const [checkingPreflight, setCheckingPreflight] = useState(false)
  const [wizardError, setWizardError] = useState<string | null>(null)
  const [accessTarget, setAccessTarget] = useState<PreinstalledAppRecord | null>(null)
  const [accessDraft, setAccessDraft] = useState<VhostAccessDraft | null>(null)
  const [savingAccess, setSavingAccess] = useState(false)

  const refreshApps = async () => {
    const [nextCatalog, nextInstalled, nextActivity] = await Promise.all([
      window.weebx.preinstalledAppCatalog(), window.weebx.installedApps(), window.weebx.preinstalledAppActivity()
    ])
    setCatalog(nextCatalog); setInstalled(nextInstalled); setActivity(nextActivity)
  }
  useEffect(() => {
    void refreshApps()
    return window.weebx.onPreinstalledAppProgress(setProgress)
  }, [])
  useEffect(() => {
    if (!credential) return
    const timeout = window.setTimeout(() => setCredential(null), 30000)
    const hide = () => setCredential(null)
    window.addEventListener('blur', hide)
    return () => { window.clearTimeout(timeout); window.removeEventListener('blur', hide) }
  }, [credential])
  useEffect(() => {
    if (step !== 2 || !draft || completed) return
    setCheckingPreflight(true)
    setPreflight(null)
    const timeout = window.setTimeout(() => {
      void window.weebx.preflightPreinstalledApp(draft)
        .then((result) => setPreflight(result))
        .catch((cause) => setWizardError(messageOf(cause)))
        .finally(() => setCheckingPreflight(false))
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [step, draft, completed])
  useEffect(() => {
    if (!wizardError) return
    document.querySelector('.wizard-error')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [wizardError])

  const compatibleVersions = (app: PreinstalledAppCatalogItem) => data.phpVersions.filter((version) => version.installed && appPhpCompatible(version.version, app.php.minimum, app.php.maximum))
  const begin = async (app: PreinstalledAppCatalogItem) => {
    const versions = compatibleVersions(app)
    if (!versions.length) return
    const phpVersion = versions.find((item) => item.version.startsWith(app.php.recommended))?.version ?? versions.at(-1)!.version
    const key = app.id.replace(/[^a-z0-9]+/g, '_')
    setSelected(app); setStep(0); setCompleted(null); setProgress(null); setCredential(null); setPreflight(null); setWizardError(null)
    setDraft({
      catalogId: app.id, location: 'side', projectName: app.id, domain: `${app.id}.localhost`, http: true, https: false, forceHttps: false,
      updateHosts: false, phpVersion, phpProfile: 'production', disableDangerousFunctions: true, allowUserIni: false,
      phpExtensions: [...new Set([...app.php.requiredExtensions, ...app.php.recommendedExtensions])],
      databaseName: app.database ? `${key}_db` : undefined, databaseUsername: app.database ? `${key}_app` : undefined,
      siteTitle: `My ${app.name} site`, adminUsername: 'admin', adminPassword: browserStrongPassword(), adminEmail: 'admin@example.test'
    })
    const options = await run(() => window.weebx.siteProfileOptions(phpVersion), false)
    if (options) {
      setProfileOptions(options)
      setDraft((old) => old ? { ...old, phpExtensions: old.phpExtensions.filter((extension) => options.extensions.includes(extension)) } : old)
    }
  }
  const setDraftField = <K extends keyof PreinstalledAppInstallRequest>(key: K, value: PreinstalledAppInstallRequest[K]) => setDraft((old) => old ? { ...old, [key]: value } : old)
  const updateProject = (projectName: string) => {
    if (!draft || !selected) return
    const key = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || selected.id
    setDraft({ ...draft, projectName, domain: draft.location === 'side' ? `${projectName.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || selected.id}.localhost` : 'localhost', updateHosts: false, databaseName: selected.database ? `${key}_db` : undefined, databaseUsername: selected.database ? `${key}_app`.slice(0, 32) : undefined })
  }
  const changeLocation = (location: 'default' | 'side') => draft && setDraft({ ...draft, location, domain: location === 'default' ? 'localhost' : `${draft.projectName}.localhost`, updateHosts: false })
  const changePhp = async (phpVersion: string) => {
    if (!draft || !selected) return
    const options = await run(() => window.weebx.siteProfileOptions(phpVersion), false)
    if (!options) return
    setProfileOptions(options)
    setDraft({ ...draft, phpVersion, phpExtensions: [...new Set([...selected.php.requiredExtensions, ...selected.php.recommendedExtensions.filter((item) => options.extensions.includes(item))])] })
  }
  const install = async () => {
    if (!draft) return
    setCheckingPreflight(true); setWizardError(null)
    try {
      const readiness = await window.weebx.preflightPreinstalledApp(draft)
      setPreflight(readiness)
      if (!readiness.ready) return
      setInstalling(true); setProgress(null)
      const result = await window.weebx.installPreinstalledApp(draft)
      setCompleted(result)
      await refreshApps()
    } catch (cause) {
      setWizardError(messageOf(cause))
    } finally { setCheckingPreflight(false); setInstalling(false) }
  }
  const uninstall = async () => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      const result = await run(() => window.weebx.uninstallPreinstalledApp(removeTarget.id || removeTarget.siteId || removeTarget.domain, removeChoices))
      if (result) { setRemoveTarget(null); setCredential(null); await refreshApps() }
    } finally { setRemoving(false) }
  }
  const reveal = async (record: PreinstalledAppRecord) => {
    const result = await run(() => window.weebx.revealInstalledAppConnection(record.id), false)
    if (result) setCredential(result)
  }
  const markComplete = async (record: PreinstalledAppRecord) => {
    const result = await run(() => window.weebx.completePreinstalledAppSetup(record.id), false)
    if (result) await refreshApps()
  }

  const categories = ['all', ...new Set(catalog.map((item) => item.category))]
  const visible = catalog.filter((item) => (category === 'all' || item.category === category) && `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(search.toLowerCase()))
  const installedIds = new Set(installed.map((item) => item.catalogId))
  const canContinueHost = Boolean(draft && draft.projectName.trim() && draft.domain.trim() && (draft.http || draft.https))
  const canContinueRuntime = Boolean(draft && selected && selected.php.requiredExtensions.every((extension) => draft.phpExtensions.includes(extension)) && (!selected.database || draft.databaseName && draft.databaseUsername))
  const needsAccount = selected?.setup === 'automatic' && selected.account !== false
  const canContinueAdmin = Boolean(!selected || selected.setup !== 'automatic' || (draft?.siteTitle?.trim() && (!needsAccount || (draft.adminUsername && (draft.adminPassword?.length ?? 0) >= 12 && draft.adminEmail))))

  return <>
    <div className="apps-hero"><div><span><Sparkles size={13} /> ONE-CLICK APPLICATIONS</span><h2>Your next site, ready in minutes.</h2><p>WeebX handles the package, domain, HTTPS, PHP runtime, modules, database identity, and audit trail. Auto setup apps finish completely; Manual finish apps keep their own installer.</p></div><div className="apps-hero-stat"><b>{catalog.length}</b><span>open-source apps</span><small>{installed.length} installed locally</small></div></div>
    <div className="apps-tabs"><button className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}><PackageOpen size={15} /> App library <span>{catalog.length}</span></button><button className={view === 'installed' ? 'active' : ''} onClick={() => setView('installed')}><ShieldCheck size={15} /> Installed <span>{installed.length}</span></button><button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><ListChecks size={15} /> Activity <span>{activity.length}</span></button></div>

    {view === 'catalog' && <><div className="apps-toolbar"><label><Search size={15} /><input aria-label="Search apps" placeholder="Search apps, categories, or use cases…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="category-scroll">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item === 'all' ? 'All apps' : item}</button>)}</div></div>
      <div className="app-catalog">{visible.map((app) => { const versions = compatibleVersions(app); const isInstalled = installedIds.has(app.id); return <article className={`app-card app-${app.category}`} key={app.id}><div className="app-card-top"><AppLogo id={app.id} name={app.name} /><div className="app-badges"><span>{app.category}</span>{app.setup === 'automatic' ? <span className="auto"><Sparkles size={10} /> Auto setup</span> : <span className="manual">Manual finish</span>}</div></div><h3>{app.name}</h3><p>{app.description}</p><small className="app-setup-hint">{app.setupSummary}</small><div className="app-meta"><span>v{app.version}</span><span>{app.license}</span><span>PHP {app.php.minimum}+</span></div><div className="app-card-foot">{!versions.length ? <span className="compat-error"><CircleAlert size={13} /> No compatible PHP installed</span> : <span className="compat-ok"><Check size={13} /> PHP {versions.map((item) => item.version).join(', ')}</span>}<ActionButton className="primary" disabled={!versions.length} label={isInstalled ? 'Install another' : 'Install'} icon={<ChevronRight size={14} />} onClick={() => begin(app)} /></div></article> })}</div>
      {!visible.length && <div className="big-empty app-empty"><Search size={28} /><h3>No apps found</h3><p>Try another search or category.</p></div>}</>}

    {view === 'installed' && <div className="installed-apps">{installed.map((record) => { const catalogApp = catalog.find((item) => item.id === record.catalogId); const setup = record.setup ?? catalogApp?.setup ?? (record.setupUrl ? 'browser' : 'automatic'); const revealed = credential?.installId === record.id; return <article key={record.id}><AppLogo id={record.catalogId} name={record.name} /><div className="installed-main"><div><h3>{record.name}</h3><span className={record.status}>{record.status === 'needs-setup' ? 'Finish setup · local only' : 'Ready'}</span><span className={setup === 'automatic' ? 'auto' : 'manual'}>{setup === 'automatic' ? 'Auto setup' : 'Manual finish'}</span></div><button className="installed-url" onClick={() => void window.weebx.openExternal(record.setupUrl || record.url)}>{record.url}<ExternalLink size={11} /></button><div className="tags"><span>{record.location === 'default' ? 'Default website' : 'Side website'}</span><span>DNS {record.domain}</span><span>PHP {record.phpVersion}</span>{record.databaseName && <span><Database size={11} /> {record.databaseName}</span>}{record.databaseUsername && <span>DB user {record.databaseUsername}</span>}{record.adminUsername && <span>Admin {record.adminUsername}</span>}<span>{new Date(record.createdAt).toLocaleDateString()}</span></div>{revealed && credential && <dl className="app-credential">{connectionRows(credential).map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.href ? <button type="button" className="connection-link" onClick={() => void window.weebx.openExternal(row.value)}><code>{row.value}</code><ExternalLink size={11} /></button> : <code>{row.value}</code>}</dd></div>)}<small>{credential.adminPassword ? 'Administrator password included. ' : credential.setup === 'automatic' ? 'This install has no stored administrator password. ' : ''}{credential.database ? 'Database password included. ' : ''}Passwords are encrypted with your Windows credentials and hidden after 30 seconds.</small></dl>}</div><div className="row-actions app-row-actions">{record.status === 'needs-setup' && <ActionButton className="setup-done" title="Verify setup, clean the installer, and enable access" icon={<Check size={16} />} onClick={() => markComplete(record)} />}<ActionButton title="Open website" icon={<ExternalLink size={16} />} onClick={() => window.weebx.openExternal(record.setupUrl || record.url)} /><ActionButton title="Open files" icon={<FolderOpen size={16} />} onClick={() => window.weebx.openPath(record.documentRoot)} /><ActionButton title="Edit HTTPS and DNS host" icon={<Wrench size={16} />} onClick={() => { const site = data.virtualHosts.find((item) => item.id === record.siteId); setAccessTarget(record); setAccessDraft({ http: site?.http ?? true, https: site?.https ?? Boolean(record.url.startsWith('https:')), forceHttps: record.forceHttps === true, updateHosts: Boolean(site?.managedHosts?.length) }) }} /><ActionButton title="Reveal connection details" icon={<KeyRound size={16} />} onClick={() => reveal(record)} /><ActionButton className="trash" title="Uninstall" icon={<Trash2 size={16} />} onClick={() => { setRemoveTarget(record); setRemoveChoices({ removeFiles: true, removeDatabase: true, removeSite: true }) }} /></div></article> })}{!installed.length && <div className="big-empty app-empty"><PackageOpen size={30} /><h3>No applications installed</h3><p>Pick an app from the library and WeebX will prepare everything.</p><ActionButton className="primary" icon={<ChevronLeft size={15} />} label="Browse app library" onClick={() => setView('catalog')} /></div>}</div>}

    {view === 'activity' && <div className="app-activity"><div className="activity-head"><div><h3>Application audit trail</h3><p>Persistent install, configuration, rollback, and uninstall events.</p></div><ActionButton icon={<RefreshCw size={14} />} label="Refresh" onClick={refreshApps} /></div>{[...activity].reverse().map((entry) => <div className="activity-row" key={entry.id}><span className={`activity-dot ${entry.level}`} /><time>{new Date(entry.timestamp).toLocaleString()}</time><b>{catalog.find((item) => item.id === entry.catalogId)?.name ?? entry.catalogId}</b><em>{entry.phase}</em><p>{entry.message}</p></div>)}{!activity.length && <Empty text="No application activity yet" />}</div>}

    {selected && draft && <Modal wide title={`${completed ? 'Installed' : 'Install'} · ${selected.name}`} onClose={() => !installing && setSelected(null)}><div className="app-wizard"><div className="wizard-rail"><div className="wizard-app"><AppLogo id={selected.id} name={selected.name} /><span><b>{selected.name}</b><small>Version {selected.version}</small></span></div>{['Website', 'PHP & database', selected.setup === 'automatic' && selected.account !== false ? 'Admin & review' : 'Review & install'].map((label, index) => <div key={label} className={`wizard-step ${step === index ? 'active' : ''} ${step > index || completed ? 'done' : ''}`}><i>{step > index || completed ? <Check size={12} /> : index + 1}</i><span>{label}</span></div>)}<div className="wizard-security"><ShieldCheck size={15} /><span><b>Managed safely</b><small>Official source · isolated PHP · least-privilege database</small></span></div></div><div className="wizard-content">
        {!completed && !installing && step === 0 && <>
          <div className="wizard-heading"><span>01 · WEBSITE</span><h3>Where should it live?</h3><p>Use the main localhost website or create a separate local domain.</p></div>
          <div className="location-choice"><button className={draft.location === 'default' ? 'active' : ''} onClick={() => changeLocation('default')}><Globe2 size={21} /><b>Default website</b><small>Install at <code>localhost</code> in the htdocs root.</small>{draft.location === 'default' && <Check size={15} />}</button><button className={draft.location === 'side' ? 'active' : ''} onClick={() => changeLocation('side')}><Boxes size={21} /><b>Side website</b><small>Creates a local DNS host with its own folder. Use <code>.localhost</code> with no Administrator, or map any name in Windows hosts.</small>{draft.location === 'side' && <Check size={15} />}</button></div>
          <div className="wizard-fields"><label>Project name<input value={draft.projectName} onChange={(event) => updateProject(event.target.value)} /></label><label>DNS host<input disabled={draft.location === 'default'} value={draft.domain} onChange={(event) => { const domain = event.target.value; setDraft((old) => old ? { ...old, domain, updateHosts: automaticLocalhost(domain) ? false : old.updateHosts } : old) }} /></label></div>
          <SiteAccessControls http={draft.http} https={draft.https} forceHttps={draft.forceHttps} updateHosts={draft.updateHosts} showHosts={draft.location === 'side' && !automaticLocalhost(draft.domain)} automaticDns={automaticLocalhost(draft.domain)} domain={draft.domain} onChange={(patch) => setDraft((old) => old ? { ...old, ...patch, forceHttps: patch.https === false || patch.http === false ? false : (patch.forceHttps ?? old.forceHttps) } : old)} />
          {draft.https && <p className="wizard-certificate-note"><CircleAlert size={13} /> WeebX creates a local self-signed certificate. You can turn HTTPS off later from Installed apps. For a public deployment, replace the certificate with a trusted CA/ACME certificate.</p>}
        </>}
        {!completed && !installing && step === 1 && <><div className="wizard-heading"><span>02 · RUNTIME</span><h3>Compatibility, already handled.</h3><p>Required modules stay locked on. Add optional modules and choose the security policy that fits the app.</p></div><div className="runtime-picker"><label>PHP version<select value={draft.phpVersion} onChange={(event) => void changePhp(event.target.value)}>{compatibleVersions(selected).map((item) => <option key={item.version}>{item.version}</option>)}</select></label><div><span>Compatibility</span><b><Check size={13} /> PHP {selected.php.minimum}{selected.php.maximum ? `–${selected.php.maximum}` : '+'}</b></div><label>Environment<select value={draft.phpProfile ?? 'production'} onChange={(event) => setDraftField('phpProfile', event.target.value as 'production' | 'development')}><option value="production">Live / Production</option><option value="development">Development</option></select></label></div><div className="module-picker"><div><b>PHP modules</b><span>{draft.phpExtensions.length} enabled · {selected.php.requiredExtensions.length} required</span></div><div>{(profileOptions?.extensions ?? draft.phpExtensions).map((extension) => { const required = selected.php.requiredExtensions.includes(extension); const enabled = draft.phpExtensions.includes(extension); return <button key={extension} className={enabled ? 'on' : ''} disabled={required} title={required ? 'Required by this app' : 'Optional module'} onClick={() => setDraftField('phpExtensions', enabled ? draft.phpExtensions.filter((item) => item !== extension) : [...draft.phpExtensions, extension].sort())}><i>{enabled ? <Check size={10} /> : <Plus size={10} />}</i>{extension}{required && <small>required</small>}</button> })}</div></div><div className="wizard-toggles security-toggles"><Toggle checked={draft.disableDangerousFunctions !== false} onChange={(disableDangerousFunctions) => setDraftField('disableDangerousFunctions', disableDangerousFunctions)} label="Block PHP process-execution functions" /><Toggle checked={draft.allowUserIni === true} onChange={(allowUserIni) => setDraftField('allowUserIni', allowUserIni)} label="Allow app .user.ini overrides" /></div>{draft.phpProfile === 'development' && <p className="wizard-certificate-note danger-note"><CircleAlert size={13} /> Development mode displays error detail and is not suitable for a public site.</p>}{selected.database && <div className="wizard-fields database-wizard"><label>Database name<input value={draft.databaseName} onChange={(event) => setDraftField('databaseName', event.target.value)} /></label><label>Database username<input value={draft.databaseUsername} onChange={(event) => setDraftField('databaseUsername', event.target.value)} /></label><p><Database size={14} /> A unique per-app MariaDB login gets access to this database only. Its generated password is encrypted with your Windows credentials and never written to the audit log.</p></div>}</>}
        {!completed && !installing && step === 2 && <><div className="wizard-heading"><span>03 · {needsAccount ? 'ACCOUNT & REVIEW' : 'REVIEW'}</span><h3>{needsAccount ? 'Create your administrator.' : selected.setup === 'automatic' ? 'Name this site, then install.' : 'Ready for a guided finish.'}</h3><p>{needsAccount ? 'These credentials go to the local installer. WeebX encrypts the administrator password with your Windows credentials and can reveal it, with the site and admin links, from Installed apps.' : selected.setup === 'automatic' ? 'No administrator account is required. Confirm the local DNS host and HTTPS settings, then install.' : 'WeebX prepares every server detail, then opens the app’s own setup screen for the final preferences.'}</p></div>{selected.setup === 'automatic' && <div className={`wizard-fields admin-fields${needsAccount ? '' : ' title-only'}`}><label>Site title<input value={draft.siteTitle} onChange={(event) => setDraftField('siteTitle', event.target.value)} /></label>{needsAccount && <label>Admin email<input type="email" value={draft.adminEmail} onChange={(event) => setDraftField('adminEmail', event.target.value)} /></label>}{needsAccount && <label>Admin username<input value={draft.adminUsername} onChange={(event) => setDraftField('adminUsername', event.target.value)} /></label>}{needsAccount && <SecretField label="Admin password" value={draft.adminPassword || ''} onChange={(value) => setDraftField('adminPassword', value)} action={<button type="button" onClick={() => setDraftField('adminPassword', browserStrongPassword())}><RefreshCw size={12} /> Regenerate</button>} />}</div>}<div className="review-edit"><span>Local DNS host & access</span><SiteAccessControls http={draft.http} https={draft.https} forceHttps={draft.forceHttps} updateHosts={draft.updateHosts} showHosts={draft.location === 'side' && !automaticLocalhost(draft.domain)} automaticDns={automaticLocalhost(draft.domain)} domain={draft.domain} onChange={(patch) => setDraft((old) => old ? { ...old, ...patch, forceHttps: patch.https === false || patch.http === false ? false : (patch.forceHttps ?? old.forceHttps) } : old)} /></div><div className="install-review"><div><span>Application</span><b>{selected.name} {selected.version}</b></div><div><span>Address</span><b>{draft.https ? 'https' : 'http'}://{draft.domain}</b></div><div><span>DNS host</span><b>{automaticLocalhost(draft.domain) ? `${draft.domain} · automatic` : draft.updateHosts ? `${draft.domain} · Windows hosts` : draft.domain}</b></div><div><span>HTTPS</span><b>{draft.https ? (draft.forceHttps ? 'On · redirect HTTP' : 'On') : 'Off'}</b></div><div><span>Runtime</span><b>PHP {draft.phpVersion} · {draft.phpExtensions.length} modules</b></div><div><span>Database</span><b>{selected.database ? draft.databaseName : 'Not required'}</b></div><div><span>Setup</span><b>{selected.setup === 'automatic' ? 'Fully automatic' : 'Browser-guided finish'}</b></div><div><span>License</span><b>{selected.license}</b></div></div><div className="preflight-panel"><div className="preflight-head"><ListChecks size={15} /><b>{checkingPreflight ? 'Checking requirements…' : preflight?.ready ? 'Ready to install' : 'Action required'}</b></div>{preflight?.checks.map((check) => <div className={`preflight-check ${check.status}`} key={check.id}>{check.status === 'ready' ? <Check size={13} /> : <CircleAlert size={13} />}<span><b>{check.title}</b><small>{check.detail}</small></span></div>)}{preflight?.suggestedProjectName && <button type="button" className="preflight-action" onClick={() => updateProject(preflight.suggestedProjectName!)}>Use “{preflight.suggestedProjectName}”</button>}{preflight?.requiresElevation && <button type="button" className="preflight-action admin" onClick={() => void window.weebx.restartAsAdministrator().catch((cause) => setWizardError(messageOf(cause)))}><ShieldCheck size={13} /> Restart WeebX as administrator</button>}</div><div className="install-notice"><ShieldCheck size={16} /><p>Downloaded over HTTPS from the project’s official distribution source. Extraction rejects path traversal and oversized archives. Failed installs are rolled back.</p></div></>}
        {installing && <div className="install-progress-view"><div className="progress-orbit"><PackageOpen size={28} /><i style={{ '--app-progress': `${progress?.percent ?? 1}%` } as React.CSSProperties} /></div><span>{progress?.phase ?? 'starting'}</span><h3>{progress?.message ?? `Preparing ${selected.name}…`}</h3><p>{progress?.detail ?? 'Keep WeebX open while the application is being prepared.'}</p><div className="app-progress-track"><i style={{ width: `${progress?.percent ?? 1}%` }} /></div><b>{progress?.percent ?? 1}%</b></div>}
        {completed && <div className="install-complete"><div><Check size={34} /></div><span>{completed.status === 'installed' ? 'INSTALLATION COMPLETE' : 'FILES & SERVER READY'}</span><h3>{completed.name} is {completed.status === 'installed' ? 'ready to use.' : 'ready to finish.'}</h3><p>{completed.status === 'installed' ? 'WeebX completed the application setup, site profile, and database configuration. Open Installed apps any time to reveal the site and admin links, administrator password, and database details.' : 'Open the official browser wizard to finish this app. DNS, database username, and the generated password are available from Installed apps.'}</p><button className="complete-url" onClick={() => window.weebx.openExternal(completed.setupUrl || completed.url)}>{completed.setupUrl || completed.url}<ExternalLink size={14} /></button><div className="complete-actions"><ActionButton icon={<FolderOpen size={15} />} label="Open files" onClick={() => window.weebx.openPath(completed.documentRoot)} /><ActionButton className="primary" icon={<ExternalLink size={15} />} label={completed.status === 'installed' ? 'Open website' : 'Finish setup'} onClick={() => window.weebx.openExternal(completed.setupUrl || completed.url)} /></div></div>}
        {wizardError && !completed && <div className="wizard-error" role="alert"><CircleAlert size={15} /><span>{wizardError}</span><button type="button" aria-label="Dismiss error" onClick={() => setWizardError(null)}><X size={14} /></button></div>}
        {!completed && !installing && <div className="wizard-actions"><button onClick={() => step === 0 ? setSelected(null) : setStep(step - 1)}>{step === 0 ? 'Cancel' : <><ChevronLeft size={14} /> Back</>}</button>{step < 2 ? <button className="primary" disabled={step === 0 ? !canContinueHost : !canContinueRuntime} onClick={() => setStep(step + 1)}>Continue <ChevronRight size={14} /></button> : <button className="primary install-now" disabled={checkingPreflight || !preflight?.ready || !canContinueAdmin} onClick={() => void install()}><Sparkles size={14} /> {checkingPreflight ? 'Checking…' : `Install ${selected.name}`}</button>}</div>}
      </div></div></Modal>}

    {removeTarget && <Modal title={`Uninstall ${removeTarget.name}`} onClose={() => !removing && setRemoveTarget(null)}><div className="uninstall-app-form"><div className="uninstall-warning"><Trash2 size={20} /><div><b>Choose which app data to delete.</b><p>The managed virtual host, database login, hosts entry, certificate, PHP profile, and logs are always cleaned. File removal is guarded by the ownership marker and htdocs boundary.</p></div></div><Toggle checked={removeChoices.removeFiles} onChange={(removeFiles) => setRemoveChoices({ ...removeChoices, removeFiles })} label={`Application files · ${removeTarget.documentRoot}`} />{removeTarget.databaseName && <Toggle checked={removeChoices.removeDatabase} onChange={(removeDatabase) => setRemoveChoices({ ...removeChoices, removeDatabase })} label={`Database data · ${removeTarget.databaseName}`} />}<div className="uninstall-managed"><ShieldCheck size={15} /><span>Always removed: virtual host and per-app database login for <b>{removeTarget.domain}</b></span></div><div className="modal-actions"><button onClick={() => setRemoveTarget(null)}>Cancel</button><ActionButton className="danger" working={removing} icon={<Trash2 size={14} />} label="Uninstall app" onClick={uninstall} /></div></div></Modal>}

    {accessTarget && accessDraft && <Modal title={`Access · ${accessTarget.domain}`} onClose={() => !savingAccess && setAccessTarget(null)}><div className="uninstall-app-form access-edit-form"><div className="site-access-card"><div><Globe2 size={18} /><span><b>Local DNS host</b><small>{automaticLocalhost(accessTarget.domain) ? `${accessTarget.domain} resolves automatically on this PC. Change HTTP and HTTPS here without editing the Windows hosts file.` : `Treat ${accessTarget.domain} as a local DNS host. WeebX can map it in Windows hosts, or you can edit C:\\Windows\\System32\\drivers\\etc\\hosts (look for BEGIN WEEBX HOST).`}</small></span></div></div><SiteAccessControls http={accessDraft.http} https={accessDraft.https} forceHttps={accessDraft.forceHttps} updateHosts={accessDraft.updateHosts} showHosts={!automaticLocalhost(accessTarget.domain)} automaticDns={automaticLocalhost(accessTarget.domain)} domain={accessTarget.domain} onChange={(patch) => setAccessDraft((old) => old ? { ...old, ...patch, forceHttps: patch.https === false || patch.http === false ? false : (patch.forceHttps ?? old.forceHttps) } : old)} />{accessDraft.updateHosts && !automaticLocalhost(accessTarget.domain) && !data.elevated && <div className="modal-admin-note"><CircleAlert size={15} /><span><b>Administrator mode may be required</b><small>Windows requires approval to change the hosts file for this DNS host.</small></span><ActionButton icon={<ShieldCheck size={13} />} label="Restart as administrator" onClick={() => window.weebx.restartAsAdministrator().catch((cause) => setWizardError(messageOf(cause)))} /></div>}<div className="modal-actions"><button type="button" onClick={() => setAccessTarget(null)}>Cancel</button><ActionButton className="primary" working={savingAccess} icon={<Save size={14} />} label="Save access" onClick={async () => { setSavingAccess(true); try { const result = await run(() => window.weebx.updateInstalledAppAccess(accessTarget.id, accessDraft)); if (result) { setAccessTarget(null); await refreshApps() } } finally { setSavingAccess(false) } }} /></div></div></Modal>}
  </>
}

function connectionRows(connection: PreinstalledAppConnection): Array<{ label: string; value: string; href?: boolean }> {
  const links = connection.links?.length
    ? connection.links
    : [{ label: 'Website URL', url: connection.url }, ...(connection.setupUrl ? [{ label: 'Setup URL', url: connection.setupUrl }] : [])]
  return [
    { label: 'DNS / domain', value: connection.domain },
    ...links.map((link) => ({ label: link.label, value: link.url, href: true })),
    { label: 'Document root', value: connection.documentRoot },
    { label: 'PHP', value: `${connection.phpVersion}${connection.phpProfile ? ` · ${connection.phpProfile}` : ''}` },
    { label: 'Setup', value: connection.setup === 'automatic' ? 'Fully automatic' : 'Browser-guided finish' },
    ...(connection.siteTitle ? [{ label: 'Site title', value: connection.siteTitle }] : []),
    ...(connection.adminUsername ? [{ label: 'Admin username', value: connection.adminUsername }] : []),
    ...(connection.adminEmail ? [{ label: 'Admin email', value: connection.adminEmail }] : []),
    ...(connection.adminPassword ? [{ label: 'Admin password', value: connection.adminPassword }] : []),
    ...(connection.database ? [
      { label: 'Database host', value: `${connection.database.host}:${connection.database.port}` },
      { label: 'Database name', value: connection.database.databaseName },
      { label: 'Database username', value: connection.database.username },
      { label: 'Database password', value: connection.database.password },
      { label: 'Database access', value: connection.database.access }
    ] : [{ label: 'Database', value: 'Not required' }])
  ]
}

function appPhpCompatible(version: string, minimum: string, maximum?: string): boolean {
  const number = (value: string) => { const [major, minor] = value.split('.').map(Number); return major * 100 + minor }
  return number(version) >= number(minimum) && (!maximum || number(version) <= number(maximum))
}

const fallbackPhpReleases: PhpRelease[] = [
  { version: '8.5.12', branch: '8.5', url: 'https://windows.php.net/downloads/releases/php-8.5.12-nts-Win32-vs17-x64.zip', sha256: '2ab242af38d76bdf417cde5ec048b1bcd76a5a40f39a3d15d5f046f38571c477', size: '34 MB', compiler: 'VS17-X64', channel: 'stable' },
  { version: '8.4.27', branch: '8.4', url: 'https://windows.php.net/downloads/releases/php-8.4.27-nts-Win32-vs17-x64.zip', sha256: '93bd8a815a52156606fb906d0573437908c61f96e2cc52c03a51e36a41bf5236', size: '34 MB', compiler: 'VS17-X64', channel: 'stable' },
  { version: '8.3.36', branch: '8.3', url: 'https://windows.php.net/downloads/releases/php-8.3.36-nts-Win32-vs16-x64.zip', sha256: '3c9242622c7402b47c38d2ec2ed779cef3a290fd6f2bde6c35f9c482699e7900', size: '33 MB', compiler: 'VS16-X64', channel: 'security' },
  { version: '8.2.35', branch: '8.2', url: 'https://windows.php.net/downloads/releases/php-8.2.35-nts-Win32-vs16-x64.zip', sha256: '798ffa4b9ce22a820d57048e9695df7245bf917ed067917f256942a10918a8cc', size: '32 MB', compiler: 'VS16-X64', channel: 'security' }
]

function PhpManager({ data, progress, run }: { data: DashboardSnapshot; progress: InstallProgress | null; run: Runner }) {
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<'automatic' | 'manual'>('automatic')
  const [releases, setReleases] = useState<PhpRelease[]>(fallbackPhpReleases)
  const [releaseMessage, setReleaseMessage] = useState('Checking the official PHP release list...')
  const [importing, setImporting] = useState(false)
  const refreshReleases = async () => {
    setReleaseMessage('Checking the official PHP release list...')
    try {
      setReleases(await window.weebx.discoverPhpReleases())
      setReleaseMessage('Verified against windows.php.net just now.')
    } catch {
      setReleaseMessage('Offline: showing the verified release list bundled with WeebX.')
    }
  }
  useEffect(() => { void refreshReleases() }, [])
  const importArchive = async () => {
    setImporting(true)
    try {
      const imported = await run(() => window.weebx.importPhpArchive())
      if (imported) setAddOpen(false)
    } finally { setImporting(false) }
  }
  return <><div className="page-toolbar"><div><h2>PHP runtime</h2><p>Switch isolated PHP versions and choose Development or hardened Live / Production settings.</p></div><div className="runtime-controls"><ActionButton icon={<Plus size={15} />} label="Add PHP version" onClick={() => setAddOpen(true)} /><div className="profile-switch"><ActionButton className={data.settings.phpProfile === 'development' ? 'active' : ''} label="Development" hideLabelWhenBusy={false} onClick={async () => (await run(() => window.weebx.setPhpProfile('development'))) !== undefined} /><ActionButton className={data.settings.phpProfile === 'production' ? 'active' : ''} label="Live / Production" hideLabelWhenBusy={false} onClick={async () => (await run(() => window.weebx.setPhpProfile('production'))) !== undefined} /></div><div className="active-runtime"><Code2 size={17} /><span>Active</span><b>{data.settings.activePhpVersion}</b></div></div></div>
    {progress && !['complete', 'error'].includes(progress.phase) && <div className="progress-card"><div><Download size={18} /><b>{progress.component} {progress.version}</b><span>{progress.message}{progress.elapsedSeconds != null ? ` · ${progress.elapsedSeconds}s` : ''}{progress.etaSeconds != null ? ` · ${progress.etaSeconds}s left` : ''}</span></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div>{progress.detail && <small>{progress.detail}</small>}</div>}
    <div className="version-list">{data.phpVersions.map((item) => <article key={item.version} className={item.active ? 'selected' : ''}><div className="version-number"><span>{item.version.split('.').slice(0, 2).join('.')}</span><small>.{item.version.split('.')[2]}</small></div><div className="version-info"><h3>PHP {item.version}</h3><p>Installed · isolated php.ini and extensions</p></div>{item.active && <span className="active-pill"><Check size={13} /> Active</span>}<ActionButton disabled={item.active} icon={item.active ? <Check size={13} /> : undefined} label={item.active ? 'In use' : 'Use this version'} onClick={async () => (await run(() => window.weebx.selectPhp(item.version))) !== undefined} /></article>)}{!data.phpVersions.length && <div className="big-empty"><Boxes size={30} /><h3>No PHP runtime installed</h3><p>Add an official version automatically or import an x64 NTS ZIP.</p><ActionButton icon={<Plus size={15} />} label="Add PHP version" onClick={() => setAddOpen(true)} /></div>}</div>
    <div className="panel runtime-note"><ShieldCheck size={21} /><div><h3>Version isolation</h3><p>Every PHP build keeps its own <code>php.ini</code> and extensions. Switching rewrites the Apache CGI binding and restarts Apache automatically.</p></div></div>
    <RuntimeTunePanel phpVersion={data.settings.activePhpVersion} run={run} />
    <ComponentInstaller data={data} progress={progress} run={run} />
    {addOpen && <Modal title="Add PHP version" onClose={() => setAddOpen(false)}><div className="php-add"><div className="php-add-tabs"><button className={addMode === 'automatic' ? 'active' : ''} onClick={() => setAddMode('automatic')}>Automatic</button><button className={addMode === 'manual' ? 'active' : ''} onClick={() => setAddMode('manual')}>Manual / advanced</button></div>{addMode === 'automatic' ? <><div className="php-release-status"><ShieldCheck size={14} /><span>{releaseMessage}</span><button onClick={() => void refreshReleases()}><RefreshCw size={13} /> Refresh</button></div><div className="php-release-list">{releases.map((release) => { const installed = data.phpVersions.some((item) => item.version === release.version); const installing = progress?.component === 'php' && progress.version === release.version && !['complete', 'error'].includes(progress.phase); return <article key={release.version}><div><b>PHP {release.version}</b><span>Official x64 NTS · {release.compiler} · {release.size}</span></div><ActionButton disabled={installed} working={installing} icon={installed ? <Check size={14} /> : <Download size={14} />} label={installed ? 'Installed' : 'Download & install'} onClick={async () => (await run(() => window.weebx.install({ component: 'php', version: release.version, url: release.url, sha256: release.sha256 }))) !== undefined} /></article> })}</div><p className="php-trust-note">Downloads come only from windows.php.net and every ZIP is checked against PHP's published SHA-256 before extraction.</p></> : <div className="php-manual"><div className="manual-callout"><Upload size={22} /><div><h3>Import a PHP ZIP</h3><p>For custom or newly downloaded builds. WeebX validates it before installation.</p></div></div><ol><li>Open the official Windows PHP downloads page.</li><li>Choose the <b>x64 Non Thread Safe (NTS)</b> ZIP—not source, debug, development, x86, or TS.</li><li>Keep the archive zipped and select it below. Only import code you trust: validation runs the selected <code>php.exe</code>.</li><li>WeebX rejects unsafe archive paths and oversized contents, then checks PHP 8.2+, 64-bit, NTS, <code>php-cgi.exe</code>, and extensions before creating the correct <code>php.ini</code>.</li><li>After import, close this popup and click <b>Use this version</b>. Apache restarts automatically if running.</li></ol><div className="manual-actions"><ActionButton icon={<ExternalLink size={14} />} label="Official PHP downloads" onClick={() => window.weebx.openExternal('https://www.php.net/downloads.php?os=windows')} /><ActionButton className="primary" working={importing} icon={<Upload size={14} />} label="Choose PHP ZIP" onClick={importArchive} /></div></div>}</div></Modal>}
  </>
}

function ComponentInstaller({ data, progress, run }: { data: DashboardSnapshot; progress: InstallProgress | null; run: Runner }) {
  const components = [
    { component: 'apache' as const, version: APACHE_VERSION, name: 'Apache HTTP Server', source: 'Apache Lounge · VS18 x64', url: 'https://www.apachelounge.com/download/VS18/binaries/httpd-2.4.69-261002-Win64-VS18.zip', sha256: '9f1f93cab9a0c6dc5e628aa640784bb30347f93fcd01b46a4c0d6b5ba76bf4e2' },
    { component: 'mariadb' as const, version: MARIADB_VERSION, name: 'MariaDB Server', source: 'MariaDB Foundation · x64', url: 'https://mirror.mariadb.org/mariadb-12.3.3/winx64-packages/mariadb-12.3.3-winx64.zip', sha256: '4b5706b47148b47c8f36963c8352d1ddee37a1287b4690428f631a74b09b85a0' },
    { component: 'phpmyadmin' as const, version: PHPMYADMIN_VERSION, name: 'phpMyAdmin', source: 'Official all-languages build', url: 'https://files.phpmyadmin.net/phpMyAdmin/5.2.3/phpMyAdmin-5.2.3-all-languages.zip', sha256: '2d2e13c735366d318425c78e4ee2cc8fc648d77faba3ddea2cd516e43885733f' }
  ]
  return <div className="components"><div className="section-title"><div><h3>Stack components</h3><p>Install or update only when you choose to. Your sites and databases are kept.</p></div></div><div className="component-grid">{components.map((item) => {
    const state = data.stackComponents.find((entry) => entry.id === item.component)
    const status = state?.status ?? 'missing'
    const busy = progress?.component === item.component && !['complete', 'error'].includes(progress.phase)
    const label = busy ? 'Working…' : status === 'installed' ? 'Installed' : status === 'outdated' ? 'Requires Updating' : 'Install'
    return <article key={item.component}><div className="component-icon">{item.component === 'apache' ? <Server /> : item.component === 'mariadb' ? <Database /> : <Globe2 />}</div><h3>{item.name}</h3><b>{item.version}</b><p>{item.source}</p><small>{status === 'missing' ? 'Not installed' : state?.installedVersion ? `Installed ${state.installedVersion}` : 'Installed'}</small><ActionButton className={status} disabled={busy || status === 'installed'} working={busy} icon={status === 'installed' ? <Check size={14} /> : <Download size={14} />} label={label} onClick={async () => (await run(() => window.weebx.install(item))) !== undefined} /></article>
  })}</div></div>
}

function ConfigEditor({ run }: { run: Runner }) {
  const [kind, setKind] = useState<ConfigKind>('php')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(null)
  useEffect(() => { void window.weebx.readConfig(kind).then((value) => { setContent(value); setDirty(false); setResult(null) }) }, [kind])
  const save = async () => { const value = await run(async () => { await window.weebx.saveConfig(kind, content); return true }, false); if (value) setDirty(false); return Boolean(value) }
  const validate = async () => { if (kind === 'vhosts') return false; setResult(await window.weebx.validateConfig(kind)) }
  return <div className="editor-wrap"><div className="editor-tabs">{(['php', 'apache', 'vhosts', 'mariadb'] as ConfigKind[]).map((item) => <button className={kind === item ? 'active' : ''} onClick={() => setKind(item)} key={item}>{item === 'php' ? 'php.ini' : item === 'apache' ? 'httpd.conf' : item === 'vhosts' ? 'httpd-vhosts.conf' : 'my.ini'}{kind === item && dirty && <i />}</button>)}</div><div className="editor-toolbar"><div><FileCode2 size={17} /><span>{kind === 'php' ? 'php.ini' : kind === 'apache' ? 'httpd.conf' : kind === 'vhosts' ? 'httpd-vhosts.conf' : 'my.ini'}</span></div><div>{kind !== 'vhosts' && <ActionButton icon={<Check size={15} />} label="Validate" onClick={validate} />}<ActionButton className="primary" disabled={!dirty} icon={<Save size={15} />} label="Save changes" onClick={save} /></div></div>{result && <div className={`validation ${result.ok ? 'ok' : 'bad'}`}>{result.ok ? <Check size={16} /> : <CircleAlert size={16} />}<pre>{result.output}</pre></div>}<textarea className="code-editor" spellCheck={false} value={content} onChange={(e) => { setContent(e.target.value); setDirty(true); setResult(null) }} /></div>
}

function Logs({ entries }: { entries: LogEntry[] }) {
  const [filter, setFilter] = useState<'all' | ServiceId | 'system'>('all')
  const filtered = useMemo(() => entries.filter((entry) => filter === 'all' || entry.service === filter), [entries, filter])
  return <div className="logs-panel"><div className="log-toolbar"><div>{(['all', 'apache', 'mariadb', 'system'] as const).map((item) => <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div><span>{filtered.length} events</span></div><div className="log-lines">{filtered.slice().reverse().map((entry) => <div key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className={`log-level ${entry.level}`}>{entry.level}</span><b>{entry.service}</b><p>{entry.message}</p></div>)}{!filtered.length && <Empty text="No matching logs" />}</div></div>
}

function SettingsPage({ settings, elevated, mariaDbRunning, run, focusPassword, onFocusedPassword }: { settings: PublicRuntimeSettings; elevated: boolean; mariaDbRunning: boolean; run: Runner; focusPassword: boolean; onFocusedPassword: () => void }) {
  const [form, setForm] = useState(settings)
  const [repairMessage, setRepairMessage] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
  const [revealingPassword, setRevealingPassword] = useState(false)
  const [permissionTarget, setPermissionTarget] = useState<PermissionTarget>('htdocs')
  const [permissionPreset, setPermissionPreset] = useState<PermissionPreset>('private')
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null)
  useEffect(() => setForm(settings), [settings])
  useEffect(() => {
    if (revealedPassword === null) return
    const timeout = window.setTimeout(() => setRevealedPassword(null), 30000)
    const hide = () => setRevealedPassword(null)
    window.addEventListener('blur', hide)
    return () => { window.clearTimeout(timeout); window.removeEventListener('blur', hide) }
  }, [revealedPassword])
  useEffect(() => {
    if (!focusPassword) return
    document.getElementById('mariadb-password')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    onFocusedPassword()
  }, [focusPassword, onFocusedPassword])
  const openStorageFolder = async (path: string) => {
    if (!path.trim()) return false
    return (await run(() => window.weebx.openPath(path.trim()), false)) !== undefined
  }
  const repair = async (pickFolder = false) => {
    if (!pickFolder) {
      const result = await run(() => window.weebx.repairLocation())
      if (result) setRepairMessage(result.message)
      if (result?.repaired || result?.message.includes('current')) return true
    }
    const path = await window.weebx.chooseDirectory(form.runtimeRoot)
    if (!path) return false
    const result = await run(() => window.weebx.repairLocation(path))
    if (result) setRepairMessage(result.message)
    return Boolean(result)
  }
  const changePassword = async () => {
    if (!mariaDbRunning) {
      setPasswordMessage('Start MariaDB first, then change the password.')
      return false
    }
    if (password !== confirmPassword) {
      setPasswordMessage('The two passwords do not match.')
      return false
    }
    const next = await run(() => window.weebx.changeMariaDbPassword(password))
    if (!next) return false
    setPasswordMessage(password ? `MariaDB password changed (${passwordStrengthLabel(password)}).` : 'MariaDB now has an empty password. Use Development only until you set a strong one.')
    setPassword('')
    setConfirmPassword('')
    setRevealedPassword(null)
  }
  const revealPassword = async () => {
    if (revealedPassword !== null) { setRevealedPassword(null); return }
    setRevealingPassword(true)
    try {
      const result = await run(() => window.weebx.revealMariaDbPassword(), false)
      if (result) setRevealedPassword(result.password)
    } finally { setRevealingPassword(false) }
  }
  const generatePassword = () => {
    let generated = browserStrongPassword()
    while (generated === password) generated = browserStrongPassword()
    setPassword(generated)
    setConfirmPassword(generated)
    setPasswordMessage('A new strong password was generated. Save it somewhere safe, then apply the change.')
  }
  const updateMariaDbPort = async () => {
    const next = await run(() => window.weebx.updateMariaDbPort(Number(form.mariadbPort)))
    if (!next) return false
    setForm((old) => ({ ...old, mariadbPort: next.mariadbPort }))
  }
  const applyPermissions = async () => {
    const result = await run(() => window.weebx.setPermissions(permissionTarget, permissionPreset))
    if (result) setPermissionMessage(result.message)
  }
  const openPermissionFolder = async () => {
    const path = permissionTarget === 'runtime' ? settings.runtimeRoot : permissionTarget === 'htdocs' ? settings.htdocsRoot : `${settings.runtimeRoot}\\mariadb\\data`
    return (await run(() => window.weebx.openPath(path), false)) !== undefined
  }
  return <div className="settings-layout"><div className="settings-main">
    <div className="panel setting-block"><PanelTitle icon={<HardDrive size={17} />} title="Storage" /><label>Runtime directory<div className="input-action"><input value={form.runtimeRoot} onChange={(e) => setForm({ ...form, runtimeRoot: e.target.value })} /><ActionButton icon={<FolderOpen size={16} />} title="Open this folder in File Explorer" onClick={() => openStorageFolder(form.runtimeRoot)} /></div></label><label>Document root<div className="input-action"><input value={form.htdocsRoot} onChange={(e) => setForm({ ...form, htdocsRoot: e.target.value })} /><ActionButton icon={<FolderOpen size={16} />} title="Open this folder in File Explorer" onClick={() => openStorageFolder(form.htdocsRoot)} /></div></label></div>
    <div className="panel setting-block permission-settings"><PanelTitle icon={<ShieldCheck size={17} />} title="Windows file permissions" /><p>Apply a safe NTFS preset. WeebX briefly stops affected services, updates only the selected stack folder, then starts them again.</p><div className="permission-controls"><label>Folder<select value={permissionTarget} onChange={(event) => setPermissionTarget(event.target.value as PermissionTarget)}><option value="htdocs">Websites (htdocs)</option><option value="database">MariaDB data</option><option value="runtime">Entire WeebX runtime</option></select></label><label>Preset<select value={permissionPreset} onChange={(event) => setPermissionPreset(event.target.value as PermissionPreset)}><option value="private">Private — current user, SYSTEM, admins</option><option value="writable">Owner writable — inherit Windows permissions</option><option value="windows-default">Reset to Windows inherited defaults</option></select></label><div className="permission-actions"><ActionButton icon={<FolderOpen size={14} />} title="Open folder for advanced Windows Security properties" onClick={openPermissionFolder} /><ActionButton className="primary" icon={<ShieldCheck size={14} />} label="Apply permissions" onClick={applyPermissions} /></div></div><small><b>Private</b> is recommended for databases and live sites. <b>Owner writable</b> is useful while developing. Advanced users can open the folder and use Windows Security properties for custom service accounts.</small>{permissionMessage && <span className="permission-result"><Check size={13} />{permissionMessage}</span>}</div>
    <div className="panel relocation-block"><PanelTitle icon={<Wrench size={17} />} title="Relocation repair" /><div><p>If you copied or moved WeebX, Fix automatically rebases Apache, MariaDB, PHP, certificates, and virtual-host paths.</p><div className="repair-actions"><ActionButton className="primary" icon={<Wrench size={15} />} label="Fix automatically" onClick={() => repair(false)} /><ActionButton icon={<FolderOpen size={15} />} label="Choose folder" onClick={() => repair(true)} /></div>{repairMessage && <span><Check size={14} /> {repairMessage}</span>}</div></div>
    <div className="panel setting-block"><PanelTitle icon={<Activity size={17} />} title="Network ports" /><div className="port-inputs"><label>HTTP<input type="number" value={form.apachePort} onChange={(e) => setForm({ ...form, apachePort: +e.target.value })} /></label><label>HTTPS<input type="number" value={form.apacheSslPort} onChange={(e) => setForm({ ...form, apacheSslPort: +e.target.value })} /></label><label className="mariadb-port">MariaDB<div className="input-action"><input type="number" value={form.mariadbPort} onChange={(e) => setForm({ ...form, mariadbPort: +e.target.value })} /><ActionButton className="primary" disabled={form.mariadbPort === settings.mariadbPort} icon={<RotateCw size={14} />} label="Update" onClick={updateMariaDbPort} /></div></label></div></div>
    <div className="panel setting-block password-settings" id="mariadb-password">
      <PanelTitle icon={<Database size={17} />} title="MariaDB login" />
      <div className="credential-grid"><div><span>Host</span><b>localhost only</b><code>127.0.0.1</code></div><div><span>Port</span><b>{form.mariadbPort}</b></div><div><span>Username</span><b>root</b></div><div className="saved-password-card"><span>Password</span><div className="saved-password-row"><code className={revealedPassword !== null ? 'revealed' : ''}>{revealedPassword !== null ? (revealedPassword || '(empty)') : '••••••••••••'}</code><button type="button" className="reveal-password" disabled={revealingPassword} onClick={revealPassword}>{revealedPassword !== null ? <EyeOff size={14} /> : <Eye size={14} />}{revealedPassword !== null ? 'Hide' : revealingPassword ? 'Confirming…' : 'Reveal'}</button></div><b className={`password-state ${settings.mariadbPasswordStrength}`}>{settings.mariadbPasswordStrength === 'strong' ? 'Strong · protected by Windows' : settings.mariadbPasswordStrength === 'empty' ? 'Empty · development only' : 'Weak · change before live use'}</b></div></div>
      <div className="password-editor">
        <div className="password-editor-heading"><div className="password-editor-icon"><KeyRound size={18} /></div><div><b>Change the root password</b><span>Enter your own password or generate a new 24-character password.</span></div></div>
        <div className="password-fields"><SecretField label="New password" value={password} placeholder="Empty is allowed for Development" onChange={(value) => { setPassword(value); setPasswordMessage(null) }} action={<button type="button" className="password-generate" onClick={generatePassword}><RefreshCw size={13} />Generate new</button>} /><SecretField label="Confirm password" value={confirmPassword} placeholder="Enter the same password again" onChange={(value) => { setConfirmPassword(value); setPasswordMessage(null) }} /></div>
        <div className="password-editor-actions"><span className={`password-meter ${password ? (strongPassword(password) ? 'strong' : 'weak') : 'empty'}`}>{password ? passwordStrengthLabel(password) : 'Empty password — allowed for Development, unsafe for Live / Production'}</span><ActionButton className="password-apply" icon={<KeyRound size={15} />} label={password ? 'Change password' : 'Set empty password'} disabled={!mariaDbRunning} onClick={changePassword} /></div>
        {!mariaDbRunning && <span className="password-result warn">Start MariaDB first, then change the password.</span>}{passwordMessage && <span className="password-result">{passwordMessage}</span>}
      </div>
      <div className="password-policy-grid"><b>Password state</b><b>Development</b><b>Live / Production</b><span>Empty</span><span>Warning</span><span className="critical">Critical warning</span><span>Weak</span><span>Warning</span><span className="high">High-priority warning</span><span>Strong</span><span className="secure">Secure status</span><span className="secure">Secure status</span></div><p className="credential-note">A non-empty password is encrypted with Windows and is only decrypted into this screen after an explicit reveal confirmation. It auto-hides after 30 seconds or when WeebX loses focus. phpMyAdmin uses cookie login and remains restricted to this machine.</p>
    </div>
    <div className="panel setting-block recovery-settings"><PanelTitle icon={<RefreshCw size={17} />} title="Crash recovery" /><p>Choose how long WeebX waits before restarting Apache or MariaDB after an unexpected exit.</p><label>Restart delay<select value={form.autoRestartDelayMs} onChange={(event) => setForm({ ...form, autoRestartDelayMs: Number(event.target.value) as RuntimeSettings['autoRestartDelayMs'] })}><option value={5000}>5 seconds</option><option value={10000}>10 seconds</option><option value={30000}>30 seconds</option><option value={60000}>1 minute</option><option value={300000}>5 minutes</option></select></label><div className="recovery-summary"><span className={form.autoRestartApache ? 'enabled' : ''}>Apache {form.autoRestartApache ? 'on' : 'off'}</span><span className={form.autoRestartMariaDb ? 'enabled' : ''}>MariaDB {form.autoRestartMariaDb ? 'on' : 'off'}</span></div></div>
    <div className="panel setting-block"><PanelTitle icon={<Settings size={17} />} title="Behavior" /><Toggle checked={form.startOnLaunch} onChange={(startOnLaunch) => setForm({ ...form, startOnLaunch })} label="Start Apache and MariaDB when WeebX opens" /><Toggle checked={form.startWithWindows} onChange={(startWithWindows) => setForm({ ...form, startWithWindows })} label="Automatically start WeebX on Windows startup" /><Toggle checked={form.minimizeToTray} onChange={(minimizeToTray) => setForm({ ...form, minimizeToTray })} label="Keep running in the notification area" /><Toggle checked={form.checkPortsBeforeStart} onChange={(checkPortsBeforeStart) => setForm({ ...form, checkPortsBeforeStart })} label="Check port ownership before starting" /></div>
    <ActionButton className="primary save-settings" icon={<Save size={16} />} label="Save settings" onClick={async () => (await run(() => window.weebx.updateSettings(form))) !== undefined} />
  </div><aside className="settings-side"><div className={`admin-card ${elevated ? 'elevated' : ''}`}><ShieldCheck size={25} /><h3>{elevated ? 'Administrator mode' : 'Standard mode'}</h3><p>{elevated ? 'WeebX can update your Windows hosts file.' : 'Administrator mode lets the app wizard map local domains automatically.'}</p>{!elevated && <ActionButton className="admin-restart" icon={<ShieldCheck size={14} />} label="Restart as administrator" onClick={() => run(() => window.weebx.restartAsAdministrator(), false)} />}</div><div className="panel links"><h3>Quick links</h3><ActionButton icon={<ExternalLink size={14} />} label="PHP documentation" hideLabelWhenBusy={false} onClick={() => window.weebx.openExternal('https://www.php.net/')} /><ActionButton icon={<ExternalLink size={14} />} label="Apache documentation" hideLabelWhenBusy={false} onClick={() => window.weebx.openExternal('https://httpd.apache.org/docs/2.4/')} /><ActionButton icon={<ExternalLink size={14} />} label="MariaDB documentation" hideLabelWhenBusy={false} onClick={() => window.weebx.openExternal('https://mariadb.com/kb/en/documentation/')} /></div></aside></div>
}

function SecuritySetup({ run, error }: { run: Runner; error: string | null }) {
  const [password, setPassword] = useState(() => browserStrongPassword())
  const [confirmPassword, setConfirmPassword] = useState(() => password)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const complete = async () => {
    if (password !== confirmPassword) { setMessage('The two passwords do not match.'); return }
    setWorking(true)
    try {
      const result = await run(() => window.weebx.completeSecuritySetup(password))
      if (!result) setMessage(null)
    } finally { setWorking(false) }
  }
  const setupError = message || error
  const strength = password ? (strongPassword(password) ? 'strong' : 'weak') : 'empty'
  const regenerate = () => {
    let generated = browserStrongPassword()
    while (generated === password) generated = browserStrongPassword()
    setPassword(generated)
    setConfirmPassword(generated)
    setMessage(null)
  }
  return <div className="security-setup-backdrop"><section className="security-setup" role="dialog" aria-modal="true" aria-labelledby="security-setup-title"><div className="security-setup-icon"><ShieldCheck size={30} /></div><span>FIRST-RUN SETUP</span><h2 id="security-setup-title">Choose your MariaDB password</h2><p>Use the generated strong password, enter your own, or choose an empty password for local development. WeebX will keep reminding you until the password is strong.</p><div className="setup-fields"><SecretField label="MariaDB password (optional)" value={password} onChange={setPassword} action={<button type="button" className="password-generate" onClick={regenerate}><RefreshCw size={13} />Regenerate</button>} /><SecretField label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} /></div><small className={strength}>{password ? passwordStrengthLabel(password) : 'Empty password — Development only'}</small>{setupError && <div className="setup-error"><CircleAlert size={15} />{setupError}</div>}<div className="setup-choice"><button type="button" onClick={() => { setPassword(''); setConfirmPassword(''); setMessage(null) }}>Use empty password</button><ActionButton className="primary setup-submit" working={working} icon={<LockKeyhole size={16} />} label="Complete setup" onClick={complete} /></div><p className="setup-note">Development is the default environment. MariaDB stays on 127.0.0.1, while phpMyAdmin and PHP diagnostics remain local-only.</p></section></div>
}

type Runner = <T>(operation: () => Promise<T>, after?: boolean) => Promise<T | undefined>
function Logo() { return <div className="logo"><img src={logoUrl} alt="WeebX" /></div> }
function AdminBadge({ elevated, onRestart }: { elevated: boolean; onRestart: () => Promise<unknown> }) {
  if (elevated) return <div className="admin-badge on"><ShieldCheck size={15} />Admin</div>
  return <button type="button" className="admin-badge admin-badge-action" title="Restart WeebX as administrator" onClick={() => void onRestart()}><ShieldCheck size={15} />Standard <ChevronRight size={12} /></button>
}
function PanelTitle({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) { return <div className="panel-title"><div>{icon}<h3>{title}</h3></div>{action}</div> }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div> }
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) { return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className={`modal${wide ? ' modal-wide' : ''}`}><div className="modal-head"><h2>{title}</h2><button onClick={onClose}><X size={18} /></button></div>{children}</div></div> }
function automaticLocalhost(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost')
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <label className="toggle"><button type="button" role="switch" aria-checked={checked} className={checked ? 'on' : ''} onClick={() => onChange(!checked)}><i /></button><span>{label}</span></label> }
function SiteAccessControls({ http, https, forceHttps, updateHosts, showHosts, automaticDns, domain, onChange }: { http: boolean; https: boolean; forceHttps?: boolean; updateHosts?: boolean; showHosts: boolean; automaticDns: boolean; domain: string; onChange: (patch: Partial<VhostAccessDraft>) => void }) {
  return <div className="site-access-controls">
    <div className="wizard-toggles"><Toggle checked={http} onChange={(next) => onChange({ http: next })} label="HTTP" /><Toggle checked={https} onChange={(next) => onChange({ https: next })} label="HTTPS with local certificate" />{http && https && <Toggle checked={forceHttps === true} onChange={(next) => onChange({ forceHttps: next })} label="Redirect HTTP to HTTPS" />}{showHosts && <Toggle checked={updateHosts === true} onChange={(next) => onChange({ updateHosts: next })} label="Map in Windows hosts (requires Administrator)" />}</div>
    {automaticDns && <p className="wizard-certificate-note localhost-note"><ShieldCheck size={13} /> {domain || 'This name'} is a reserved local DNS host and resolves automatically to this PC. WeebX will not edit the Windows hosts file. You can change HTTP and HTTPS later from the app or Sites.</p>}
    {showHosts && updateHosts && <p className="wizard-certificate-note"><CircleAlert size={13} /> WeebX will add a managed Windows hosts entry so this name works like a DNS host. You can edit or remove that block later from WeebX or from <code>C:\Windows\System32\drivers\etc\hosts</code> (look for <code># BEGIN WEEBX HOST</code>).</p>}
  </div>
}
function SecretField({ label, value, onChange, placeholder, action }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; action?: ReactNode }) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  useEffect(() => { if (!value) setVisible(false) }, [value])
  return <div className="secret-field"><div className="secret-label-row"><label htmlFor={id}>{label}</label>{action}</div><div className="secret-input"><LockKeyhole className="secret-lock" size={15} /><input id={id} type={visible ? 'text' : 'password'} value={value} placeholder={placeholder} autoComplete="new-password" spellCheck={false} onChange={(event) => onChange(event.target.value)} />{value !== '' && <button type="button" className="secret-eye" title={visible ? 'Hide password' : 'Show password'} aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button>}</div></div> }
function FieldHint({ text, tip }: { text: string; tip: string }) {
  return <span className="field-hint" data-tip={tip}>{text}<button type="button" className="qmark" aria-label={tip}>?</button></span>
}
function strongPassword(value: string): boolean {
  return value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value)
}
function passwordStrengthLabel(value: string): string {
  if (!value) return 'Empty password'
  return strongPassword(value) ? 'Strong password' : 'Weak password — use 12+ characters with uppercase, lowercase, a number, and a symbol'
}
function passwordSecurityStatus(settings: PublicRuntimeSettings): { tone: 'warning' | 'high' | 'critical' | 'secure'; label: string; message: string } {
  if (settings.mariadbPasswordStrength === 'strong') return { tone: 'secure', label: 'Secure status', message: 'Ready for this environment.' }
  if (settings.phpProfile === 'development') return {
    tone: 'warning', label: 'Warning',
    message: settings.mariadbPasswordStrength === 'empty' ? 'Empty password is allowed for local development.' : 'Use a strong password before going live.'
  }
  return settings.mariadbPasswordStrength === 'empty'
    ? { tone: 'critical', label: 'Critical warning', message: 'Live / Production must not use an empty database password.' }
    : { tone: 'high', label: 'High-priority warning', message: 'Strengthen the database password before exposing this host.' }
}
function browserStrongPassword(): string {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*_-+=?']
  const all = groups.join('')
  const random = (characters: string) => {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return characters[value[0] % characters.length]
  }
  const result = groups.map(random)
  while (result.length < 24) result.push(random(all))
  for (let index = result.length - 1; index > 0; index -= 1) {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    const target = value[0] % (index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result.join('')
}
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
  if (/Command failed:|mariadb\.exe\s+-u/i.test(text)) return 'Could not change the MariaDB password.'
  return text
}
function formatUptime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours) return `${hours}h ${minutes}m ${String(rest).padStart(2, '0')}s`
  if (minutes) return `${minutes}m ${String(rest).padStart(2, '0')}s`
  return `${rest}s`
}

function formatRestartDelay(delay: RuntimeSettings['autoRestartDelayMs']): string {
  if (delay >= 60000) return `${delay / 60000} min`
  return `${delay / 1000} sec`
}
