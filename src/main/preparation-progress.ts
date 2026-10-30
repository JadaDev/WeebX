export interface CopyEstimateInput {
  startedAt: number
  now: number
  completedBytes: number
  totalBytes: number
  completedFiles: number
  totalFiles: number
  extraSeconds?: number
}

export const MARIADB_SETUP_SECONDS = 50
const MAX_COPY_REMAINING_SECONDS = 20 * 60

export function estimateRemainingSeconds(input: CopyEstimateInput): number | null {
  const elapsed = Math.max(0, (input.now - input.startedAt) / 1000)
  if (elapsed < 2.5) return null
  const byteFraction = input.totalBytes > 0 ? clampUnit(input.completedBytes / input.totalBytes) : 0
  const fileFraction = input.totalFiles > 0 ? clampUnit(input.completedFiles / input.totalFiles) : 0
  const fraction = (byteFraction * 0.35) + (fileFraction * 0.65)
  if (fraction < 0.012) return null
  const remainingCopy = fraction >= 0.995 ? 0 : (elapsed / fraction) - elapsed
  const extra = Math.max(0, input.extraSeconds ?? 0)
  return Math.max(0, Math.ceil(Math.min(MAX_COPY_REMAINING_SECONDS, remainingCopy) + extra))
}

export function smoothRemainingSeconds(previous: number | null, next: number | null): number | null {
  if (next == null) return previous
  if (previous == null) return next
  const blended = (previous * 0.6) + (next * 0.4)
  const ceiling = previous + Math.max(3, previous * 0.15)
  const floor = previous - Math.max(2, previous * 0.22)
  return Math.max(0, Math.round(Math.min(ceiling, Math.max(floor, blended))))
}

export function databaseRemainingSeconds(elapsedInPhase: number, typicalSeconds = MARIADB_SETUP_SECONDS): number {
  const elapsed = Math.max(0, elapsedInPhase)
  const typical = Math.max(15, typicalSeconds)
  return Math.max(10, Math.round(typical * Math.exp(-elapsed / typical)))
}

export function copySpeed(startedAt: number, now: number, completedBytes: number): number {
  const elapsed = Math.max(0.5, (now - startedAt) / 1000)
  return Math.max(0, Math.round(completedBytes / elapsed))
}

export function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const rest = value % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${rest}s`
  return `${rest}s`
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
