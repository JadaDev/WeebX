export interface CopyEstimateInput {
  startedAt: number
  now: number
  completedBytes: number
  totalBytes: number
  completedFiles: number
  totalFiles: number
  extraSeconds?: number
}

export function estimateRemainingSeconds(input: CopyEstimateInput): number | null {
  const elapsed = Math.max(0, (input.now - input.startedAt) / 1000)
  if (elapsed < 2.5) return null
  const byteFraction = input.totalBytes > 0 ? input.completedBytes / input.totalBytes : 0
  const fileFraction = input.totalFiles > 0 ? input.completedFiles / input.totalFiles : 0
  const fraction = (byteFraction * 0.35) + (fileFraction * 0.65)
  if (fraction < 0.012) return null
  const remainingCopy = (elapsed / fraction) - elapsed
  return Math.max(0, Math.ceil(remainingCopy + (input.extraSeconds ?? 0)))
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
