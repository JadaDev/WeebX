import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { UninstallApp } from './UninstallApp'
import './styles.css'

function isUninstallMode(): boolean {
  const { hash, search } = window.location
  if (hash === '#uninstall' || hash.startsWith('#uninstall')) return true
  return new URLSearchParams(search).get('mode') === 'uninstall'
}

const uninstall = window.weebx?.isUninstall === true || isUninstallMode()
if (uninstall) {
  document.documentElement.classList.add('uninstall')
  document.title = 'Uninstall WeebX'
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
if (!window.weebx) {
  document.title = 'WeebX package error'
  root.render(<div className="fatal-boot" role="alert"><div className="fatal-boot-card"><span>WXB-PRELOAD-MISSING</span><h1>WeebX could not load its secure interface.</h1><p>A required application file is missing or was blocked. Your websites and runtime data have not been deleted.</p><p>Reinstall the latest WeebX package. If security software quarantined a file, review its history before restoring anything.</p></div></div>)
} else {
  root.render(<React.StrictMode>{uninstall ? <UninstallApp /> : <App />}</React.StrictMode>)
}
