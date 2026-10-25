import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Check, LoaderCircle } from 'lucide-react'

type ActionResult = void | boolean | Promise<void | boolean>

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  icon?: ReactNode
  label?: string
  hideLabelWhenBusy?: boolean
  working?: boolean
  onClick?: () => ActionResult
}

export function ActionButton({
  className = '',
  title,
  disabled,
  type = 'button',
  icon,
  label,
  hideLabelWhenBusy = true,
  working = false,
  onClick,
  ...rest
}: ActionButtonProps) {
  const [pending, setPending] = useState(false)
  const [flash, setFlash] = useState(false)
  const busy = working || pending
  const showDone = flash && !busy
  const showIco = Boolean(icon) || busy || showDone

  const runClick = async () => {
    if (disabled || busy || !onClick) return
    setPending(true)
    setFlash(false)
    const started = Date.now()
    try {
      const result = await onClick()
      const wait = 280 - (Date.now() - started)
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      if (result !== false) {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 700)
      }
    } catch {
      const wait = 280 - (Date.now() - started)
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      {...rest}
      type={type}
      title={title ?? label}
      className={`${className} ${busy ? 'working' : ''} ${showDone ? 'did-ok' : ''}`.trim()}
      disabled={Boolean(disabled || busy)}
      aria-busy={busy}
      onClick={onClick ? () => void runClick() : undefined}
    >
      {showIco ? <span className="btn-ico" aria-hidden>{busy ? <LoaderCircle className="spin" size={15} /> : showDone ? <Check size={15} /> : icon}</span> : null}
      {label ? <span className={`btn-label${busy && hideLabelWhenBusy ? ' away' : ''}`}>{label}</span> : null}
    </button>
  )
}
