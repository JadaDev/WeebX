import type { CSSProperties } from 'react'
import wordpressSvg from 'simple-icons/icons/wordpress.svg?raw'
import joomlaSvg from 'simple-icons/icons/joomla.svg?raw'
import drupalSvg from 'simple-icons/icons/drupal.svg?raw'
import gravSvg from 'simple-icons/icons/grav.svg?raw'
import processwireSvg from 'simple-icons/icons/processwire.svg?raw'
import phpbbSvg from 'simple-icons/icons/phpbb.svg?raw'
import nextcloudSvg from 'simple-icons/icons/nextcloud.svg?raw'
import matomoSvg from 'simple-icons/icons/matomo.svg?raw'
import moodleSvg from 'simple-icons/icons/moodle.svg?raw'
import prestashopSvg from 'simple-icons/icons/prestashop.svg?raw'
import freshrssSvg from 'simple-icons/icons/freshrss.svg?raw'
import piwigoSvg from 'simple-icons/icons/piwigo.svg?raw'
import gitSvg from 'simple-icons/icons/git.svg?raw'
import { faOpencart } from '@fortawesome/free-brands-svg-icons/faOpencart'

const path = (svg: string) => svg.match(/<path d="([^"]+)"/)?.[1] ?? ''
const simple: Record<string, { path: string; hex: string }> = {
  wordpress: { path: path(wordpressSvg), hex: '21759B' },
  joomla: { path: path(joomlaSvg), hex: '5091CD' },
  drupal: { path: path(drupalSvg), hex: '0678BE' },
  grav: { path: path(gravSvg), hex: '221E1F' },
  processwire: { path: path(processwireSvg), hex: '2480E6' },
  phpbb: { path: path(phpbbSvg), hex: '009BDF' },
  nextcloud: { path: path(nextcloudSvg), hex: '0082C9' },
  matomo: { path: path(matomoSvg), hex: '3152A0' },
  moodle: { path: path(moodleSvg), hex: 'F98012' },
  prestashop: { path: path(prestashopSvg), hex: 'DF0067' },
  freshrss: { path: path(freshrssSvg), hex: '2AB24C' },
  piwigo: { path: path(piwigoSvg), hex: 'FF7700' },
  gitlist: { path: path(gitSvg), hex: 'F05032' }
}

const privatebinPath = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm4 18H6V4h7v5h5zm-6.5-3.5 1.4-3.3h.2l1.4 3.3h1.3L15 11h-1.6l-1.7 5.5zm-3.2 0V11H7.1v5.5h1.2v-2.1h1.5c.9 0 1.5-.5 1.5-1.3 0-.8-.6-1.3-1.5-1.3zm0 2.1H8.3v-1.8h1.4c.4 0 .6.2.6.5s-.2.5-.6.5z'

const mybbPath = 'M29.81 240l13.93-45.45C16.88 174.12 0 144.52 0 111.58 0 50 59.1 0 132 0s132 50 132 111.58c0 30.7-12.62 48.08-36.35 68.26L242 223.16l-31.57-19.39c-20.55 11.16-52.2 19.39-78.43 19.39a151.34 151.34 0 0 1-59.71-12zM10.65 111.42c0 55.82 53.39 101.08 119.26 101.08s119.26-45.26 119.26-101.08S195.78 10.34 129.91 10.34 10.65 55.6 10.65 111.42z'

export function AppLogo({ id, name, className = '' }: { id: string; name: string; className?: string }) {
  const icon = simple[id]
  if (icon) return <span className={`app-logo ${className}`} title={`${name} logo`} style={{ '--app-brand': `#${icon.hex}` } as CSSProperties}><svg viewBox="0 0 24 24" aria-hidden><path d={icon.path} /></svg></span>
  if (id === 'opencart') {
    const path = Array.isArray(faOpencart.icon[4]) ? faOpencart.icon[4][0] : faOpencart.icon[4]
    return <span className={`app-logo ${className}`} title="OpenCart logo" style={{ '--app-brand': '#23a8e0' } as CSSProperties}><svg viewBox={`0 0 ${faOpencart.icon[0]} ${faOpencart.icon[1]}`} aria-hidden><path d={path} /></svg></span>
  }
  if (id === 'mybb') return <span className={`app-logo ${className}`} title="MyBB logo" style={{ '--app-brand': '#1676b9' } as CSSProperties}><svg viewBox="0 0 264 240" aria-hidden><path d={mybbPath} /></svg></span>
  if (id === 'mediawiki') return <span className={`app-logo mediawiki-logo ${className}`} title="MediaWiki logo"><svg viewBox="0 0 24 24" aria-hidden><path className="mw-bracket" d="M7.2 3H3.8v18h3.4v-2.2H6V5.2h1.2V3zm9.6 0v2.2H18v13.6h-1.2V21h3.4V3h-3.4z"/><circle cx="12" cy="6.7" r="2.15" className="mw-red"/><circle cx="8.5" cy="9.3" r="2.15" className="mw-blue"/><circle cx="15.5" cy="9.3" r="2.15" className="mw-yellow"/><circle cx="10.2" cy="13.2" r="2.15" className="mw-green"/><circle cx="13.8" cy="13.2" r="2.15" className="mw-purple"/></svg></span>
  if (id === 'privatebin') return <span className={`app-logo ${className}`} title="PrivateBin logo" style={{ '--app-brand': '#ff6b35' } as CSSProperties}><svg viewBox="0 0 24 24" aria-hidden><path d={privatebinPath} /></svg></span>
  return <span className={`app-logo ${className}`} title={name}><b>{name.slice(0, 2).toUpperCase()}</b></span>
}
