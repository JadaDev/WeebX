# WeebX version check

This page checks the versions currently bundled with WeebX against the latest upstream stable releases.

The current WeebX bundle in the project source is:

- Apache HTTP Server: 2.4.69
- PHP x64 NTS: 8.2.35, 8.3.36, 8.4.27, 8.5.12
- MariaDB Server: 12.3.3

For the automated comparison, the newest bundled PHP runtime is used as the PHP baseline: 8.5.12.

## Status logic

- CURRENT: the bundled WeebX version matches the latest upstream release
- OUTDATED: the bundled WeebX version is behind the latest upstream release
- UNKNOWN: the upstream version could not be checked

## Run the check

```bash
bash scripts/version-check.sh
```

## Example output

```text
Apache HTTP Server: BUNDLED=2.4.69, LATEST=2.4.72, STATUS OUTDATED
PHP x64 NTS: BUNDLED=8.5.12, LATEST=8.5.13, STATUS OUTDATED
MariaDB Server: BUNDLED=12.3.3, LATEST=12.3.4, STATUS OUTDATED
WeebX bundled stack is OUTDATED.
```

If everything is current, the script prints:

```text
Apache HTTP Server: BUNDLED=2.4.69, LATEST=2.4.69, STATUS CURRENT
PHP x64 NTS: BUNDLED=8.5.12, LATEST=8.5.12, STATUS CURRENT
MariaDB Server: BUNDLED=12.3.3, LATEST=12.3.3, STATUS CURRENT
WeebX bundled stack is CURRENT.
```

This check is intentionally limited to the versions WeebX actually ships in the repository, so the result is a clear yes/no answer for whether the bundle is behind upstream.
