(() => {
  const body = document.body
  const dialog = document.querySelector('#download-consent')
  const fileName = document.querySelector('#consent-file')
  const terms = document.querySelector('#accept-terms')
  const privacy = document.querySelector('#accept-privacy')
  const downloadButton = document.querySelector('.consent-download')
  let pendingDownload = null

  const formatCount = (value) => new Intl.NumberFormat().format(Math.max(0, Number(value) || 0))
  const refreshDownloadCounts = async () => {
    try {
      const response = await fetch('download.php?stats=1', { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) return
      const stats = await response.json()
      document.querySelectorAll('[data-download-count]').forEach((element) => { element.textContent = formatCount(stats.uniqueDownloads) })
      document.querySelectorAll('[data-file-download-count]').forEach((element) => {
        const name = element.dataset.fileDownloadCount
        element.textContent = formatCount(stats.files?.[name]?.downloads)
      })
    } catch {
      // The server-rendered total remains visible when the live refresh is unavailable.
    }
  }

  const finishLoading = () => window.setTimeout(() => body.classList.add('loaded'), 320)
  if (document.readyState === 'complete') finishLoading()
  else window.addEventListener('load', finishLoading, { once: true })
  void refreshDownloadCounts()

  if (!(dialog instanceof HTMLDialogElement) || !(terms instanceof HTMLInputElement) || !(privacy instanceof HTMLInputElement) || !(downloadButton instanceof HTMLButtonElement)) return

  const syncConsent = () => { downloadButton.disabled = !(terms.checked && privacy.checked) }
  const resetConsent = () => {
    terms.checked = false
    privacy.checked = false
    downloadButton.disabled = true
  }
  const closeDialog = () => {
    if (!dialog.open || dialog.classList.contains('closing')) return
    dialog.classList.add('closing')
    window.setTimeout(() => {
      dialog.close()
      dialog.classList.remove('closing')
      pendingDownload = null
      resetConsent()
    }, 240)
  }

  document.querySelectorAll('.download-trigger').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      pendingDownload = { href: link.href, name: link.dataset.file || 'WeebX' }
      if (fileName) fileName.textContent = pendingDownload.name
      resetConsent()
      dialog.showModal()
    })
  })

  terms.addEventListener('change', syncConsent)
  privacy.addEventListener('change', syncConsent)
  dialog.querySelector('.dialog-close')?.addEventListener('click', closeDialog)
  dialog.querySelector('.dialog-cancel')?.addEventListener('click', closeDialog)
  dialog.querySelectorAll('[data-close-consent]').forEach((link) => link.addEventListener('click', closeDialog))
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog() })
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect()
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
    if (outside) closeDialog()
  })
  downloadButton.addEventListener('click', () => {
    if (!pendingDownload || !terms.checked || !privacy.checked) return
    const anchor = document.createElement('a')
    anchor.href = pendingDownload.href
    anchor.download = pendingDownload.name
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => { void refreshDownloadCounts() }, 1200)
    closeDialog()
  })
})()
