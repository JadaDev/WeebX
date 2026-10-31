# WeebX Version Check

This document tracks whether the Apache, PHP, and MariaDB versions used by WeebX are current compared to their latest upstream stable releases. The goal is to keep the check current without hard-coding a static version list.

## Current server versions

Run this on the WeebX host to capture the versions currently installed:

```bash
apache=$(apache2 -v 2>&1 | awk -F/ '/Server version/ {print $2}' | tr -d ' ' || httpd -v 2>&1 | awk -F/ '/Server version/ {print $2}' | tr -d ' ')
php=$(php -v 2>/dev/null | head -n 1 | awk '{print $2}')
mariadb=$(mysql --version 2>/dev/null | awk '{print $5}' | tr -d ',' || mariadb --version 2>/dev/null | awk '{print $5}' | tr -d ',')

echo "Apache: ${apache:-Not installed}"
echo "PHP: ${php:-Not installed}"
echo "MariaDB: ${mariadb:-Not installed}"
```

## Latest upstream versions

The commands below fetch the latest stable builds directly from the official project release pages so the comparison stays current.

```bash
# Apache HTTP Server latest stable
apache_latest=$(curl -fsSL https://downloads.apache.org/httpd/ \
  | grep -Eo 'httpd-[0-9]+\.[0-9]+\.[0-9]+\.tar\.bz2' \
  | sort -V \
  | tail -n 1 \
  | sed 's/httpd-//; s/\.tar\.bz2$//')

# PHP latest stable
php_latest=$(curl -fsSL https://www.php.net/releases/ \
  | grep -Eo 'php-[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?\.tar\.gz' \
  | sort -V \
  | tail -n 1 \
  | sed 's/php-//; s/\.tar\.gz$//')

# MariaDB latest stable
mariadb_latest=$(curl -fsSL https://mariadb.org/download/ \
  | grep -Eo 'MariaDB Server [0-9]+\.[0-9]+\.[0-9]+' \
  | head -n 1 \
  | awk '{print $3}')

echo "Apache latest: ${apache_latest:-Unknown}"
echo "PHP latest: ${php_latest:-Unknown}"
echo "MariaDB latest: ${mariadb_latest:-Unknown}"
```

## Version comparison

```bash
apache_installed="$(apache2 -v 2>&1 | awk -F/ '/Server version/ {print $2}' | tr -d ' ' || httpd -v 2>&1 | awk -F/ '/Server version/ {print $2}' | tr -d ' ')"
php_installed="$(php -v 2>/dev/null | head -n 1 | awk '{print $2}')"
mariadb_installed="$(mysql --version 2>/dev/null | awk '{print $5}' | tr -d ',' || mariadb --version 2>/dev/null | awk '{print $5}' | tr -d ',')"

apache_latest="$(curl -fsSL https://downloads.apache.org/httpd/ | grep -Eo 'httpd-[0-9]+\.[0-9]+\.[0-9]+\.tar\.bz2' | sort -V | tail -n 1 | sed 's/httpd-//; s/\.tar\.bz2$//')"
php_latest="$(curl -fsSL https://www.php.net/releases/ | grep -Eo 'php-[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?\.tar\.gz' | sort -V | tail -n 1 | sed 's/php-//; s/\.tar\.gz$//')"
mariadb_latest="$(curl -fsSL https://mariadb.org/download/ | grep -Eo 'MariaDB Server [0-9]+\.[0-9]+\.[0-9]+' | head -n 1 | awk '{print $3}')"

printf '%-12s %-20s %-20s\n' "Component" "Installed" "Latest" 
printf '%-12s %-20s %-20s\n' "Apache" "${apache_installed:-Unknown}" "${apache_latest:-Unknown}"
printf '%-12s %-20s %-20s\n' "PHP" "${php_installed:-Unknown}" "${php_latest:-Unknown}"
printf '%-12s %-20s %-20s\n' "MariaDB" "${mariadb_installed:-Unknown}" "${mariadb_latest:-Unknown}"
```

## Suggested status matrix

| Component | Installed version | Latest stable | Status |
| --- | --- | --- | --- |
| Apache | `example: 2.4.58` | `auto-fetched from upstream` | `Needs review` |
| PHP | `example: 8.2.13` | `auto-fetched from upstream` | `Needs review` |
| MariaDB | `example: 10.11.8` | `auto-fetched from upstream` | `Needs review` |

## Notes

- The version checks use the official upstream release pages, so the latest values are refreshed each time the commands are run.
- For WeebX deployments, update Apache, PHP, and MariaDB together when a security or compatibility issue is detected.
- If a WeebX package or installer pins an older version intentionally for compatibility, record the reason in the deployment notes and re-check when the dependency stack changes.

## Recommended maintenance workflow

1. Run the version check on the production or staging server.
2. Compare installed versions with the latest stable upstream versions.
3. Review compatibility notes from Apache, PHP, and MariaDB before upgrading.
4. Update the deployment checklist and confirm that the WeebX stack still functions correctly after the upgrade.

This file is designed to stay current by relying on live upstream release endpoints rather than fixed values.
