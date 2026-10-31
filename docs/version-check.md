# WeebX Version Check

This file is designed to answer one question quickly: is the WeebX server stack still current, or is it behind the latest Apache, PHP, and MariaDB releases?

## Quick status summary

If the installed version is older than the latest upstream version, the component is marked as `OUTDATED`.

Example result:

```text
Apache: INSTALLED=2.4.58, LATEST=2.4.62, STATUS OUTDATED
PHP: INSTALLED=8.2.13, LATEST=8.3.12, STATUS OUTDATED
MariaDB: INSTALLED=10.11.8, LATEST=10.11.14, STATUS OUTDATED
WeebX dependency stack is OUTDATED or needs review.
```

If all versions match or are newer than the upstream release, the result will say:

```text
Apache: INSTALLED=2.4.62, LATEST=2.4.62, STATUS CURRENT
PHP: INSTALLED=8.3.12, LATEST=8.3.12, STATUS CURRENT
MariaDB: INSTALLED=10.11.14, LATEST=10.11.14, STATUS CURRENT
All checked dependencies are current.
```

## Run the check

On the WeebX server, run:

```bash
bash /path/to/scripts/version-check.sh
```

Example:

```bash
bash scripts/version-check.sh
```

## What it checks

The script compares:

- Apache installed version vs latest Apache HTTP Server release
- PHP installed version vs latest PHP release
- MariaDB installed version vs latest MariaDB release

## Version comparison logic

A component is considered `OUTDATED` if the installed version is lower than the latest upstream stable version.

- `CURRENT`: installed version matches or is newer than the latest known release
- `OUTDATED`: installed version is older than the latest known release
- `UNKNOWN`: the version could not be determined or the upstream page could not be checked

## Recommended action

If any component reports `OUTDATED`, review compatibility notes before upgrading, then move the WeebX server to a compatible updated stack.

This gives a clear yes/no answer on GitHub when someone checks the repository documentation and then runs the script on the server.
