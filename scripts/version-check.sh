#!/usr/bin/env bash
set -u
set -o pipefail

# WeebX dependency version checker
# Reads the installed Apache / PHP / MariaDB versions from the current host,
# checks the latest upstream stable versions, and reports CURRENT / OUTDATED / UNKNOWN.

trim_version() {
  printf '%s' "$1" | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n 1 || true
}

fetch_latest_apache() {
  curl -fsSL https://downloads.apache.org/httpd/ 2>/dev/null \
    | grep -Eo 'httpd-[0-9]+\.[0-9]+\.[0-9]+' \
    | sed 's/^httpd-//' \
    | sort -V \
    | tail -n 1
}

fetch_latest_php() {
  curl -fsSL https://www.php.net/releases/ 2>/dev/null \
    | grep -Eo 'php-[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?\.tar\.(gz|bz2)' \
    | sed 's/^php-//' \
    | sed 's/\.tar\.(gz|bz2)$//' \
    | sort -V \
    | tail -n 1
}

fetch_latest_mariadb() {
  curl -fsSL https://mariadb.org/download/ 2>/dev/null \
    | grep -Eo 'MariaDB Server [0-9]+\.[0-9]+\.[0-9]+' \
    | awk '{print $3}' \
    | sort -V \
    | tail -n 1
}

version_is_lower() {
  local left="$1"
  local right="$2"
  [ -n "$left" ] && [ -n "$right" ] && [ "$left" != "$right" ] && [ "$(printf '%s\n%s\n' "$left" "$right" | sort -V | head -n 1)" = "$left" ]
}

apache_installed="$( (apache2 -v 2>&1 || httpd -v 2>&1 || true) | awk -F/ '/Server version/ {print $2}' | tr -d ' ' | head -n 1 )"
[ -z "$apache_installed" ] && apache_installed="not-installed"
apache_installed="$(trim_version "$apache_installed")"
[ -z "$apache_installed" ] && apache_installed="not-installed"

php_installed="$(php -v 2>/dev/null | head -n 1 | awk '{print $2}' || echo 'not-installed')"
php_installed="$(trim_version "$php_installed")"
[ -z "$php_installed" ] && php_installed="not-installed"

mariadb_installed="$( (mysql --version 2>/dev/null || mariadb --version 2>/dev/null || true) | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 )"
[ -z "$mariadb_installed" ] && mariadb_installed="not-installed"

apache_latest="$(fetch_latest_apache || echo 'unknown')"
php_latest="$(fetch_latest_php || echo 'unknown')"
mariadb_latest="$(fetch_latest_mariadb || echo 'unknown')"

status_component() {
  local component="$1"
  local installed="$2"
  local latest="$3"

  if [ "$installed" = "not-installed" ]; then
    echo "$component: INSTALLED=not-installed, LATEST=${latest:-unknown}, STATUS UNKNOWN"
    return 1
  fi

  if [ "$latest" = "unknown" ]; then
    echo "$component: INSTALLED=$installed, LATEST=unknown, STATUS UNKNOWN"
    return 1
  fi

  if [ "$installed" = "$latest" ]; then
    echo "$component: INSTALLED=$installed, LATEST=$latest, STATUS CURRENT"
    return 0
  fi

  if version_is_lower "$installed" "$latest"; then
    echo "$component: INSTALLED=$installed, LATEST=$latest, STATUS OUTDATED"
    return 2
  fi

  echo "$component: INSTALLED=$installed, LATEST=$latest, STATUS CURRENT"
  return 0
}

status=0
status_component "Apache" "$apache_installed" "$apache_latest" || status=$?
status_component "PHP" "$php_installed" "$php_latest" || status=$?
status_component "MariaDB" "$mariadb_installed" "$mariadb_latest" || status=$?

printf '\n'
if [ "$status" -ne 0 ]; then
  echo "WeebX dependency stack is OUTDATED or needs review."
else
  echo "WeebX dependency stack is CURRENT."
fi

exit 0
