export function isUninstallConfirmation(value: string): boolean {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z]/g, '') === 'UNINSTALL'
}
