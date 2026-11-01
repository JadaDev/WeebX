import { describe, expect, it } from 'vitest'
import { datedAppFolder, defaultAppDomain, isIntentionalMainSiteInstall, isMainSiteHostname, isUnderMainSite, mainSiteUrl, nextDatedAppFolder, occupiesMainSite } from './site-layout'

describe('site layout names', () => {
  it('keeps the public subdomain clean while the folder includes the install date', () => {
    expect(datedAppFolder('wordpress', new Date(2026, 9, 31))).toBe('wordpress10312026')
    expect(datedAppFolder('MyBB', new Date(2026, 9, 31))).toBe('mybb10312026')
    expect(defaultAppDomain('wordpress')).toBe('wordpress.localhost')
    expect(defaultAppDomain('My Blog!', 'wordpress')).toBe('myblog.localhost')
  })

  it('never reuses main-site, phpmyadmin, or an occupied dated folder', () => {
    expect(nextDatedAppFolder('wordpress10312026', ['wordpress10312026', 'main-site'])).toBe('wordpress10312026-2')
    expect(nextDatedAppFolder('main-site', [])).toBe('main-site-2')
  })

  it('reserves localhost for the main website', () => {
    expect(isMainSiteHostname('localhost')).toBe(true)
    expect(isMainSiteHostname('127.0.0.1')).toBe(true)
    expect(isMainSiteHostname('wordpress.localhost')).toBe(false)
  })

  it('opens the main website on the loopback address so a cached localhost redirect cannot steal it', () => {
    expect(mainSiteUrl(80)).toBe('http://127.0.0.1/')
    expect(mainSiteUrl(8080)).toBe('http://127.0.0.1:8080/')
  })

  it('keeps intentional main-site catalog installs and leaves leftover root installs to migrate', () => {
    const htdocs = 'C:\\WeebX\\htdocs'
    expect(isUnderMainSite('C:\\WeebX\\htdocs\\main-site', htdocs)).toBe(true)
    expect(isUnderMainSite('C:\\WeebX\\htdocs\\main-site\\public', htdocs)).toBe(true)
    expect(isUnderMainSite('C:\\WeebX\\htdocs\\wordpress10312026', htdocs)).toBe(false)
    expect(isIntentionalMainSiteInstall({ location: 'default', domain: 'localhost', documentRoot: 'C:\\WeebX\\htdocs\\main-site' }, htdocs)).toBe(true)
    expect(occupiesMainSite({ status: 'installed', location: 'default', domain: 'localhost', documentRoot: 'C:\\WeebX\\htdocs\\main-site' }, htdocs)).toBe(true)
    expect(occupiesMainSite({ status: 'removed', location: 'default', domain: 'localhost', documentRoot: 'C:\\WeebX\\htdocs\\main-site' }, htdocs)).toBe(false)
    expect(isIntentionalMainSiteInstall({ location: 'default', domain: 'localhost', documentRoot: 'C:\\WeebX\\htdocs' }, htdocs)).toBe(false)
    expect(isIntentionalMainSiteInstall({ location: 'side', domain: 'wordpress.localhost', documentRoot: 'C:\\WeebX\\htdocs\\wordpress10312026' }, htdocs)).toBe(false)
  })
})
