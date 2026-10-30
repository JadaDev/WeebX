# Contributing to WeebX

Thank you for helping improve WeebX.

## Development setup

Requirements:

- Windows 10 or 11 x64
- Node.js 22 or newer
- PowerShell 5.1 or newer

Install the exact JavaScript dependencies recorded in the lock file:

```powershell
npm ci
npm run typecheck
npm test
npm run dev
```

Electron is installed by npm. Do not commit `node_modules`, Electron binaries,
compiled output, release packages, downloaded runtimes, databases, or local
websites.

To download the pinned Apache, PHP, MariaDB and phpMyAdmin runtime archives and
verify their SHA-256 hashes:

```powershell
npm run prepare:runtime
```

To build signed production installers after preparing the runtime:

```powershell
$env:CSC_LINK = 'C:\secure\path\weebx-signing-certificate.pfx'
$env:CSC_KEY_PASSWORD = '<provided securely outside the repository>'
npm run dist
```

The public download site lives in `website\WeebX`. Do not commit release binaries into `website\WeebX\Files`.

## Pull requests

1. Keep changes focused and explain their user-visible effect.
2. Add or update tests for service management, filesystem, configuration, or
   security-sensitive behavior.
3. Run `npm run typecheck`, `npm test`, and `npm run build` before submitting.
4. Never include credentials, private keys, user databases, analytics data, or
   generated runtime files.
5. Report security vulnerabilities privately as described in `SECURITY.md`.
