const HARMLESS_MARIADB = [
  /failed to retrieve the MAC address/i,
  /unable to (?:determine|obtain|retrieve) the MAC address/i,
  /could not (?:get|obtain|retrieve) the MAC address/i
]

export function isHarmlessMariaDbLine(line: string): boolean {
  const text = line.trim()
  if (!text) return true
  return HARMLESS_MARIADB.some((pattern) => pattern.test(text))
}

export function mariadbProgressDetail(output: string): string | null {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (isHarmlessMariaDbLine(line)) continue
    if (/\[(?:warning|warn|note|system|info)\]/i.test(line)) continue
    if (/^copyright\b/i.test(line)) continue
    return line
  }
  return null
}

export function mariadbFailureOutput(output: string, code: number | null): string {
  const useful = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isHarmlessMariaDbLine(line))
    .join('\n')
    .trim()
  return useful || (code == null ? 'MariaDB setup stopped without an exit code.' : `exit ${code}`)
}
