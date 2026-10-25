import type { LogEntry, ServiceId } from '../shared/types'

type LogListener = (entry: LogEntry) => void

export class LogBuffer {
  private entries: LogEntry[] = []
  private listeners = new Set<LogListener>()

  add(service: ServiceId | 'system', level: LogEntry['level'], message: string): void {
    const clean = message.trim()
    if (!clean) return
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      service,
      level,
      message: clean
    }
    this.entries.push(entry)
    if (this.entries.length > 1000) this.entries.splice(0, this.entries.length - 1000)
    this.listeners.forEach((listener) => listener(entry))
  }

  list(): LogEntry[] {
    return [...this.entries]
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
