# WeebX security policy

## Supported version

Security fixes are applied to the latest published WeebX release. Users should
upgrade to the newest release and keep all bundled web-stack components current.

## Reporting a vulnerability

Please do not publish exploit details in a public issue. Use GitHub's private
vulnerability reporting or open a private draft security advisory for the
`JadaDev/WeebX` repository. Include:

- the affected WeebX version;
- reproduction steps and required configuration;
- impact and attack preconditions;
- relevant logs or a minimal proof of concept; and
- any suggested remediation.

Remove personal data, credentials and private project content before attaching
logs or examples.

## Security model

WeebX is a local Windows development environment, not a hardened public-hosting
platform. Keep Apache and MariaDB behind an appropriate firewall unless you have
intentionally secured the host, services and applications for public access.

The Electron renderer runs with `nodeIntegration` disabled, `contextIsolation`
enabled and sandboxing enabled. Privileged operations are exposed through the
preload bridge and main-process IPC handlers. Changes to that boundary require
security review and tests.

Large third-party runtimes are intentionally not stored in this repository.
The runtime preparation script downloads pinned releases and verifies each
archive against its recorded SHA-256 digest before extraction.
