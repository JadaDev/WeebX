import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, Boxes, Check, ChevronRight, CircleAlert, Code2, Database, Download,
  CircleHelp, ExternalLink, Eye, EyeOff, FileCode2, FolderOpen, Gauge, Globe2, HardDrive, KeyRound, LockKeyhole,
  Orbit, Play, Plus, Power, RefreshCw, RotateCw, Save, Server, Settings, ShieldCheck,
  Square, Terminal, Trash2, Wrench, X, Zap
} from 'lucide-react'
import type { DashboardSnapshot, InstallProgress, LogEntry, RuntimeSettings, ServiceId, ServiceStatus, VhostDraft } from '../../shared/types'
import { APACHE_VERSION, MARIADB_VERSION, PHPMYADMIN_VERSION, WEEBX_VERSION } from '../../shared/version'
import logoUrl from './assets/weebx-logo.png'
import { ActionButton } from './ActionButton'
import { RuntimeTunePanel } from './RuntimeTune'
import { PortalPack } from './PortalPack'
import { UninstallApp } from './UninstallApp'

type Page = 'dashboard' | 'sites' | 'php' | 'config' | 'logs' | 'portal' | 'settings'
type ConfigKind = 'php' | 'apache' | 'vhosts' | 'mariadb'

const emptySnapshot: DashboardSnapshot = {
  services: [], ports: [], virtualHosts: [], phpVersions: [], stackComponents: [], elevated: false,
  settings: { runtimeRoot: '', htdocsRoot: '', apachePort: 80, apacheSslPort: 443, mariadbPort: 3306, mariadbPassword: '', activePhpVersion: '8.5.12', phpProfile: 'development', startOnLaunch: false, minimizeToTray: true, checkPortsBeforeStart: true, startWithWindows: false, autoRestartApache: false, autoRestartMariaDb: false, autoRestartDelayMs: 10000 }
}

const nav: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
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
    sites: <Sites data={data} run={run} />,
    php: <PhpManager data={data} progress={progress} run={run} />,
    config: <ConfigEditor run={run} />,
    logs: <Logs entries={logs} />,
    portal: <PortalPack run={run} />,
    settings: <SettingsPage settings={data.settings} elevated={data.elevated} mysqlRunning={data.services.some((item) => item.id === 'mariadb' && item.state === 'running')} run={run} focusPassword={focusPassword} onFocusedPassword={() => setFocusPassword(false)} />
  }

  if (uninstallOpen) return <UninstallApp />
  if (loading) return <div className="splash"><div className="title-drag" /><div className="splash-mark"><i className="splash-ring" /><Logo /></div></div>
  return <div className="shell">
    <div className="title-drag" />
    <aside>
      <button type="button" className="brand" title="Open weebx.jadadev.com" onClick={() => void window.weebx.openExternal('https://weebx.jadadev.com/')}><Logo /><div><strong>WeebX</strong><span>Development Tool</span></div></button>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={18} /><span>{label}</span>{id === 'logs' && hasUnreadLogError && <i />}</button>)}</nav>
      <div className="sidebar-foot">
        <div className={`health ${data.services.every((item) => item.state === 'running') ? 'ok' : ''}`}><Activity size={16} /><div><b>{data.services.filter((item) => item.state === 'running').length}/{data.services.length} services</b><span>{data.services.some((item) => item.state === 'error') ? 'Attention needed' : 'System ready'}</span></div></div>
        <span className="version">Made by JadaDev - WeebX {WEEBX_VERSION}</span>
      </div>
    </aside>
    <main>
      <header><div><p>LOCAL ENVIRONMENT</p><h1>{nav.find((item) => item.id === page)?.label}</h1></div><div className="header-actions"><ActionButton className="icon-btn" title="Refresh" icon={<RefreshCw size={17} />} onClick={() => refresh()} /><AdminBadge elevated={data.elevated} /></div></header>
      {error && <div className="alert"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError(null)}><X size={16} /></button></div>}
      <section className={`page${page === 'config' || page === 'logs' ? ' fill' : ''}`}>{content[page]}</section>
    </main>
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
    <div className="hero"><div><span className="eyebrow"><Zap size={14} /> WORKSPACE ONLINE</span><h2>Your local web stack,<br /><em>under control.</em></h2><p>Run Apache, MariaDB and multiple PHP versions from one quiet control plane.</p><div className="hero-actions"><ActionButton className="primary" disabled={allRunning || heroBusy === 'stop'} working={heroBusy === 'start'} icon={<Play size={16} fill="currentColor" />} label="Start all" onClick={() => runStack('start')} /><ActionButton disabled={!anyRunning || heroBusy === 'start'} working={heroBusy === 'stop'} icon={<Square size={15} fill="currentColor" />} label="Stop all" onClick={() => runStack('stop')} /></div></div><div className="hero-orbit"><div className="orb"><span>{running}</span><small>RUNNING</small></div><i className="orbit o1" /><i className="orbit o2" /></div></div>
    <div className="section-title"><div><h3>Services</h3><p>Processes managed by WeebX</p></div></div>
    <div className="service-grid">{data.services.map((service) => <ServiceCard key={service.id} service={service} settings={data.settings} phpMyAdminUrl={phpMyAdminUrl} websiteUrl={websiteUrl} run={run} onChangePassword={onChangePassword} />)}</div>
    <div className="dashboard-grid"><div className="panel"><PanelTitle icon={<HardDrive size={17} />} title="Port health" action={<ActionButton className="text-btn scan-btn" icon={<RefreshCw size={12} />} label="Scan again" onClick={async () => (await run(() => window.weebx.ports())) !== undefined} />} /><div className="port-list">{data.ports.map((port) => <div key={port.port}><span className={port.available ? 'dot free' : 'dot busy'} /><b>:{port.port}</b><span>{port.available ? 'Available' : port.processName || 'In use'}</span>{port.pid && <code>PID {port.pid}</code>}</div>)}</div></div>
      <div className="panel"><PanelTitle icon={<Terminal size={17} />} title="Recent activity" /><div className="mini-logs">{logs.slice(-80).reverse().map((entry) => <div key={entry.id} title={entry.message}><span>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><i className={entry.level} /> <p>{entry.message}</p></div>)}{!logs.length && <Empty text="No activity yet" />}</div></div></div>
  </>
}

function ServiceCard({ service, settings, phpMyAdminUrl, websiteUrl, run, onChangePassword }: { service: ServiceStatus; settings: RuntimeSettings; phpMyAdminUrl: string; websiteUrl: string; run: Runner; onChangePassword: () => void }) {
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
    <h3>{service.id === 'mariadb' ? 'MySQL' : service.name}</h3>
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

function Sites({ data, run }: { data: DashboardSnapshot; run: Runner }) {
  const [show, setShow] = useState(false)
  const [help, setHelp] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<VhostDraft>({ name: '', serverName: '', aliases: [], http: true, https: false, updateHosts: true })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setCreating(true)
    try {
      if (await run(() => window.weebx.createVhost(draft))) {
        setShow(false)
        setHelp(false)
        setDraft({ name: '', serverName: '', aliases: [], http: true, https: false, updateHosts: true })
      }
    } finally { setCreating(false) }
  }
  return <><div className="page-toolbar"><div><h2>Virtual hosts</h2><p>Each site gets its own folder, domain and optional local certificate.</p></div><ActionButton className="primary" icon={<Plus size={16} />} label="New site" onClick={() => { setShow(true) }} /></div>
    <div className="site-list">{data.virtualHosts.map((site) => <article key={site.id}><div className="site-glyph"><Globe2 size={20} /></div><div className="site-main"><div><h3>{site.serverName}</h3><span className={site.enabled ? 'enabled' : 'disabled'}>{site.enabled ? 'Enabled' : 'Disabled'}</span></div><p>{site.documentRoot}</p><div className="tags">{site.http && <span>HTTP</span>}{site.https && <span><LockKeyhole size={11} /> HTTPS</span>}{site.aliases.map((alias) => <span key={alias}>{alias}</span>)}</div></div><div className="row-actions"><ActionButton title="Open folder" icon={<FolderOpen size={17} />} onClick={async () => (await run(() => window.weebx.openPath(site.documentRoot), false)) !== undefined} /><ActionButton title={site.enabled ? 'Disable' : 'Enable'} icon={<Power size={17} />} onClick={async () => (await run(() => window.weebx.setVhostEnabled(site.id, !site.enabled))) !== undefined} /><ActionButton className="trash" title="Remove (files are preserved)" icon={<Trash2 size={17} />} onClick={async () => { if (!confirm(`Remove ${site.serverName}? Project files will be preserved.`)) return false; return (await run(() => window.weebx.deleteVhost(site.id))) !== undefined }} /></div></article>)}{!data.virtualHosts.length && <div className="big-empty"><Globe2 size={30} /><h3>No virtual hosts yet</h3><p>Create a project and map a local domain in under a minute.</p><ActionButton icon={<Plus size={16} />} label="Create your first site" onClick={() => { setShow(true) }} /></div>}</div>
    {show && <Modal title="Create virtual host" onClose={() => { setShow(false); setHelp(false) }}><form className="form" onSubmit={(event) => void submit(event)}>
      <label><FieldHint text="Project Name (Folder)" tip="Folder WeebX creates inside htdocs for this site's files. Example: test-jadadev-com" /><input required placeholder="test-jadadev-com" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label><FieldHint text="Server name" tip="The domain Apache will answer for, such as test.jadadev.com. Visitors use this hostname to reach the site." /><input required placeholder="test.jadadev.com" value={draft.serverName} onChange={(e) => setDraft({ ...draft, serverName: e.target.value })} /></label>
      <label><FieldHint text="Aliases" tip="Optional extra hostnames that also serve this same folder, separated by commas. Example: www.test.jadadev.com" /><input placeholder="www.test.jadadev.com, api.test.jadadev.com" value={draft.aliases.join(', ')} onChange={(e) => setDraft({ ...draft, aliases: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label>
      <div className="check-row"><span className="toggle-with-hint"><Toggle checked={draft.http} onChange={(http) => setDraft({ ...draft, http })} label="HTTP" /><button type="button" className="qmark" title="Serve this site over HTTP (port 80 by default)." aria-label="HTTP help">?</button></span><span className="toggle-with-hint"><Toggle checked={draft.https} onChange={(https) => setDraft({ ...draft, https })} label="HTTPS (self-signed)" /><button type="button" className="qmark" title="Also serve HTTPS with a WeebX self-signed certificate. Browsers will warn until you trust it." aria-label="HTTPS help">?</button></span></div>
      <span className="toggle-with-hint"><Toggle checked={draft.updateHosts} onChange={(updateHosts) => setDraft({ ...draft, updateHosts })} label="Map domain to 127.0.0.1 in Windows hosts" /><button type="button" className="qmark" title="Adds the domain to this PC's hosts file so it opens locally. On a VPS you should use DNS instead — see Help." aria-label="Hosts mapping help">?</button></span>
      <p className="hint">The project folder will be created inside <code>{data.settings.htdocsRoot}</code>. Updating hosts requires administrator rights.</p>
      <div className="modal-actions"><button type="button" onClick={() => setHelp(true)}><CircleHelp size={15} /> Help</button><div className="modal-actions-end"><button type="button" onClick={() => { setShow(false); setHelp(false) }}>Cancel</button><ActionButton className="primary" type="submit" working={creating} icon={<Plus size={16} />} label="Create site" /></div></div>
    </form></Modal>}
    {help && <Modal title="How virtual hosts work" onClose={() => setHelp(false)}>
      <div className="help-copy">
        <p>A virtual host tells Apache which folder to serve when someone asks for a domain name.</p>
        <p><b>On this computer:</b> turn on “Map domain to 127.0.0.1 in Windows hosts” so test.jadadev.com opens the local site.</p>
        <p><b>On a Machine / VPS / Dedicated Server:</b> add DNS for the domain (an A record, and AAAA if you use IPv6) pointing to the IP of this Machine / VPS / Dedicated Server. Until that DNS record exists, the domain will not reach WeebX.</p>
        <p>The project name is only the folder. The server name is the real hostname you put in DNS or the hosts file.</p>
      </div>
      <div className="modal-actions"><button className="primary" type="button" onClick={() => setHelp(false)}>Got it</button></div>
    </Modal>}
  </>
}

const packages = [
  { component: 'php' as const, version: '8.2.35', label: 'PHP 8.2', note: 'Security fixes', url: 'https://downloads.php.net/~windows/releases/php-8.2.35-nts-Win32-vs16-x64.zip', sha256: '798ffa4b9ce22a820d57048e9695df7245bf917ed067917f256942a10918a8cc' },
  { component: 'php' as const, version: '8.3.36', label: 'PHP 8.3', note: 'Security fixes', url: 'https://downloads.php.net/~windows/releases/php-8.3.36-nts-Win32-vs16-x64.zip', sha256: '3c9242622c7402b47c38d2ec2ed779cef3a290fd6f2bde6c35f9c482699e7900' },
  { component: 'php' as const, version: '8.4.27', label: 'PHP 8.4', note: 'Active support', url: 'https://downloads.php.net/~windows/releases/php-8.4.27-nts-Win32-vs17-x64.zip', sha256: '93bd8a815a52156606fb906d0573437908c61f96e2cc52c03a51e36a41bf5236' },
  { component: 'php' as const, version: '8.5.12', label: 'PHP 8.5', note: 'Latest stable', url: 'https://downloads.php.net/~windows/releases/php-8.5.12-nts-Win32-vs17-x64.zip', sha256: '2ab242af38d76bdf417cde5ec048b1bcd76a5a40f39a3d15d5f046f38571c477' }
]

function PhpManager({ data, progress, run }: { data: DashboardSnapshot; progress: InstallProgress | null; run: Runner }) {
  return <><div className="page-toolbar"><div><h2>PHP runtime</h2><p>All official extension DLLs are included. Switch runtime and configuration profile independently.</p></div><div className="runtime-controls"><div className="profile-switch"><ActionButton className={data.settings.phpProfile === 'development' ? 'active' : ''} label="Development" hideLabelWhenBusy={false} onClick={async () => (await run(() => window.weebx.setPhpProfile('development'))) !== undefined} /><ActionButton className={data.settings.phpProfile === 'production' ? 'active' : ''} label="Deploy" hideLabelWhenBusy={false} onClick={async () => (await run(() => window.weebx.setPhpProfile('production'))) !== undefined} /></div><div className="active-runtime"><Code2 size={17} /><span>Active</span><b>{data.settings.activePhpVersion}</b></div></div></div>
    {progress && !['complete', 'error'].includes(progress.phase) && <div className="progress-card"><div><Download size={18} /><b>{progress.component} {progress.version}</b><span>{progress.message}{progress.elapsedSeconds != null ? ` · ${progress.elapsedSeconds}s` : ''}{progress.etaSeconds != null ? ` · ${progress.etaSeconds}s left` : ''}</span></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div>{progress.detail && <small>{progress.detail}</small>}</div>}
    <div className="version-list">{packages.map((pkg) => { const state = data.phpVersions.find((item) => item.version === pkg.version); const installing = progress?.component === 'php' && progress.version === pkg.version && !['complete', 'error'].includes(progress.phase); return <article key={pkg.version} className={state?.active ? 'selected' : ''}><div className="version-number"><span>{pkg.version.split('.').slice(0, 2).join('.')}</span><small>.{pkg.version.split('.')[2]}</small></div><div className="version-info"><h3>{pkg.label}</h3><p>{pkg.note} · x64 NTS</p></div>{state?.active && <span className="active-pill"><Check size={13} /> Active</span>}{state?.installed ? <ActionButton disabled={state.active} icon={state.active ? <Check size={13} /> : undefined} label={state.active ? 'In use' : 'Use this version'} onClick={async () => (await run(() => window.weebx.selectPhp(pkg.version))) !== undefined} /> : <ActionButton className="install" working={installing} icon={<Download size={15} />} label="Install" onClick={async () => (await run(() => window.weebx.install(pkg))) !== undefined} />}</article> })}</div>
    <div className="panel runtime-note"><ShieldCheck size={21} /><div><h3>Version isolation</h3><p>Every PHP build keeps its own <code>php.ini</code> and extensions. Switching rewrites the Apache CGI binding and restarts Apache automatically.</p></div></div>
    <RuntimeTunePanel phpVersion={data.settings.activePhpVersion} run={run} />
    <ComponentInstaller data={data} progress={progress} run={run} />
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

function SettingsPage({ settings, elevated, mysqlRunning, run, focusPassword, onFocusedPassword }: { settings: RuntimeSettings; elevated: boolean; mysqlRunning: boolean; run: Runner; focusPassword: boolean; onFocusedPassword: () => void }) {
  const [form, setForm] = useState(settings)
  const [repairMessage, setRepairMessage] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showStored, setShowStored] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  useEffect(() => setForm(settings), [settings])
  useEffect(() => {
    if (!focusPassword) return
    document.getElementById('mysql-password')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    onFocusedPassword()
  }, [focusPassword, onFocusedPassword])
  const choose = async (key: 'runtimeRoot' | 'htdocsRoot') => {
    const path = await window.weebx.chooseDirectory()
    if (!path) return false
    setForm({ ...form, [key]: path })
  }
  const repair = async (pickFolder = false) => {
    if (!pickFolder) {
      const result = await run(() => window.weebx.repairLocation())
      if (result) setRepairMessage(result.message)
      if (result?.repaired || result?.message.includes('current')) return true
    }
    const path = await window.weebx.chooseDirectory()
    if (!path) return false
    const result = await run(() => window.weebx.repairLocation(path))
    if (result) setRepairMessage(result.message)
    return Boolean(result)
  }
  const changePassword = async () => {
    if (!mysqlRunning) {
      setPasswordMessage('Start MySQL first, then change the password.')
      return false
    }
    if (password !== confirmPassword) {
      setPasswordMessage('The two passwords do not match.')
      return false
    }
    const next = await run(() => window.weebx.changeMariaDbPassword(password))
    if (!next) return false
    setPasswordMessage(password ? 'MySQL root password was reset.' : 'MySQL root password was cleared.')
    setPassword('')
    setConfirmPassword('')
    setShowStored(false)
  }
  const updateMysqlPort = async () => {
    const next = await run(() => window.weebx.updateMysqlPort(Number(form.mariadbPort)))
    if (!next) return false
    setForm((old) => ({ ...old, mariadbPort: next.mariadbPort }))
  }
  return <div className="settings-layout"><div className="settings-main"><div className="panel setting-block"><PanelTitle icon={<HardDrive size={17} />} title="Storage" /><label>Runtime directory<div className="input-action"><input value={form.runtimeRoot} onChange={(e) => setForm({ ...form, runtimeRoot: e.target.value })} /><ActionButton icon={<FolderOpen size={16} />} onClick={() => choose('runtimeRoot')} /></div></label><label>Document root<div className="input-action"><input value={form.htdocsRoot} onChange={(e) => setForm({ ...form, htdocsRoot: e.target.value })} /><ActionButton icon={<FolderOpen size={16} />} onClick={() => choose('htdocsRoot')} /></div></label></div><div className="panel relocation-block"><PanelTitle icon={<Wrench size={17} />} title="Relocation repair" /><div><p>If you copied or moved WeebX, Fix automatically rebases Apache, MariaDB, PHP, certificates, and virtual-host paths. You can also choose the new folder yourself, or run setup_weebx.bat beside WeebX.exe.</p><div className="repair-actions"><ActionButton className="primary" icon={<Wrench size={15} />} label="Fix automatically" onClick={() => repair(false)} /><ActionButton icon={<FolderOpen size={15} />} label="Choose folder" onClick={() => repair(true)} /></div>{repairMessage && <span><Check size={14} /> {repairMessage}</span>}</div></div><div className="panel setting-block"><PanelTitle icon={<Activity size={17} />} title="Network ports" /><div className="port-inputs"><label>HTTP<input type="number" value={form.apachePort} onChange={(e) => setForm({ ...form, apachePort: +e.target.value })} /></label><label>HTTPS<input type="number" value={form.apacheSslPort} onChange={(e) => setForm({ ...form, apacheSslPort: +e.target.value })} /></label><label className="mysql-port">MySQL<div className="input-action"><input type="number" value={form.mariadbPort} onChange={(e) => setForm({ ...form, mariadbPort: +e.target.value })} /><ActionButton className="primary" disabled={form.mariadbPort === settings.mariadbPort} icon={<RotateCw size={14} />} label="Update" onClick={updateMysqlPort} /></div></label></div></div><div className="panel setting-block" id="mysql-password"><PanelTitle icon={<Database size={17} />} title="MySQL / MariaDB login" /><div className="credential-grid"><div><span>Host</span><b>localhost</b><code>127.0.0.1</code></div><div><span>Port</span><b>{form.mariadbPort}</b></div><div><span>Username</span><b>root</b></div><div><span>Password</span>{settings.mariadbPassword ? <b className="secret-stored">{showStored ? settings.mariadbPassword : '••••••'}<button type="button" className="secret-eye" title={showStored ? 'Hide password' : 'Show password'} aria-label={showStored ? 'Hide password' : 'Show password'} onClick={() => setShowStored((value) => !value)}>{showStored ? <EyeOff size={14} /> : <Eye size={14} />}</button></b> : <b>(none)</b>}</div></div><div className="password-fields"><SecretField label="New password" value={password} placeholder="Leave empty to use no password" onChange={setPassword} /><SecretField label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} /><ActionButton icon={<KeyRound size={15} />} label="Change password" disabled={!mysqlRunning} onClick={changePassword} /></div>{!mysqlRunning && <span className="password-result warn">Start MySQL first, then change the password.</span>}{passwordMessage && <span className="password-result">{passwordMessage}</span>}<p className="credential-note">Forgot the old password? Type a new one and WeebX force-resets local root. phpMyAdmin at <button className="text-btn" onClick={() => void window.weebx.openExternal(`http://127.0.0.1:${form.apachePort || 80}/phpmyadmin/`)}>http://localhost/phpmyadmin/</button> uses this account.</p></div><div className="panel setting-block recovery-settings"><PanelTitle icon={<RefreshCw size={17} />} title="Crash recovery" /><p>Choose how long WeebX waits before restarting Apache or MySQL after an unexpected exit. Dashboard switches work even while a service is stopped.</p><label>Restart delay<select value={form.autoRestartDelayMs} onChange={(event) => setForm({ ...form, autoRestartDelayMs: Number(event.target.value) as RuntimeSettings['autoRestartDelayMs'] })}><option value={5000}>5 seconds</option><option value={10000}>10 seconds</option><option value={30000}>30 seconds</option><option value={60000}>1 minute</option><option value={300000}>5 minutes</option></select></label><div className="recovery-summary"><span className={form.autoRestartApache ? 'enabled' : ''}>Apache {form.autoRestartApache ? 'on' : 'off'}</span><span className={form.autoRestartMariaDb ? 'enabled' : ''}>MySQL {form.autoRestartMariaDb ? 'on' : 'off'}</span></div></div><div className="panel setting-block"><PanelTitle icon={<Settings size={17} />} title="Behavior" /><Toggle checked={form.startOnLaunch} onChange={(startOnLaunch) => setForm({ ...form, startOnLaunch })} label="Start Apache and MySQL when WeebX opens" /><Toggle checked={form.startWithWindows} onChange={(startWithWindows) => setForm({ ...form, startWithWindows })} label="Automatically start WeebX on Windows startup" /><Toggle checked={form.minimizeToTray} onChange={(minimizeToTray) => setForm({ ...form, minimizeToTray })} label="Keep running in the notification area" /><Toggle checked={form.checkPortsBeforeStart} onChange={(checkPortsBeforeStart) => setForm({ ...form, checkPortsBeforeStart })} label="Check port ownership before starting" /></div><ActionButton className="primary save-settings" icon={<Save size={16} />} label="Save settings" onClick={async () => (await run(() => window.weebx.updateSettings(form))) !== undefined} /></div><aside className="settings-side"><div className={`admin-card ${elevated ? 'elevated' : ''}`}><ShieldCheck size={25} /><h3>{elevated ? 'Administrator mode' : 'Standard mode'}</h3><p>{elevated ? 'WeebX can update your Windows hosts file.' : 'Run as administrator when you want WeebX to map local domains automatically.'}</p></div><div className="panel links"><h3>Quick links</h3><ActionButton icon={<ExternalLink size={14} />} label="PHP documentation" hideLabelWhenBusy={false} onClick={() => window.weebx.openExternal('https://www.php.net/')} /><ActionButton icon={<ExternalLink size={14} />} label="Apache documentation" hideLabelWhenBusy={false} onClick={() => window.weebx.openExternal('https://httpd.apache.org/docs/2.4/')} /><ActionButton icon={<ExternalLink size={14} />} label="MariaDB documentation" hideLabelWhenBusy={false} onClick={() => window.weebx.openExternal('https://mariadb.com/kb/en/documentation/')} /></div></aside></div>
}

type Runner = <T>(operation: () => Promise<T>, after?: boolean) => Promise<T | undefined>
function Logo() { return <div className="logo"><img src={logoUrl} alt="WeebX" /></div> }
function AdminBadge({ elevated }: { elevated: boolean }) { return <div className={`admin-badge ${elevated ? 'on' : ''}`}><ShieldCheck size={15} />{elevated ? 'Admin' : 'Standard'}</div> }
function PanelTitle({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) { return <div className="panel-title"><div>{icon}<h3>{title}</h3></div>{action}</div> }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}><X size={18} /></button></div>{children}</div></div> }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) { return <label className="toggle"><button type="button" role="switch" aria-checked={checked} className={checked ? 'on' : ''} onClick={() => onChange(!checked)}><i /></button><span>{label}</span></label> }
function SecretField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { if (!value) setVisible(false) }, [value])
  return <label className="secret-field">{label}<div className="secret-input"><input type={visible ? 'text' : 'password'} value={value} placeholder={placeholder} autoComplete="new-password" onChange={(event) => onChange(event.target.value)} />{value !== '' && <button type="button" className="secret-eye" title={visible ? 'Hide password' : 'Show password'} aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={14} /> : <Eye size={14} />}</button>}</div></label> }
function FieldHint({ text, tip }: { text: string; tip: string }) {
  return <span className="field-hint">{text}<button type="button" className="qmark" title={tip} aria-label={tip}>?</button></span>
}
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
  if (/Command failed:|mariadb\.exe\s+-u/i.test(text)) return 'Could not change the MySQL password.'
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
