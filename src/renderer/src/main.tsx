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

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{uninstall ? <UninstallApp /> : <App />}</React.StrictMode>)
