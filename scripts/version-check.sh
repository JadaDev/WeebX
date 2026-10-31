#!/usr/bin/env bash
set -uo pipefail

# WeebX bundled version checker
# Compares the versions shipped in the project source to the latest upstream releases.
# It is intentionally limited to the versions listed in README.md.

WEEBX_APACHE="2.4.69"
WEEBX_PHP="8.5.12"
WEEBX_MARIADB="12.3.3"

fetch_latest_apache() {
  curl -fsSL https://downloads.apache.org/httpd/ 2>/dev/null \
    | grep -Eo 'httpd-[0-9]+\.[0-9]+\.[0-9]+' \
    | sed 's/^httpd-//' \
    | sort -V \
    | tail -n 1 || echo 'unknown'
}

fetch_latest_php() {
  curl -fsSL https://www.php.net/releases/ 2>/dev/null \
    | grep -Eo 'php-[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?\.tar\.(gz|bz2)' \
    | sed 's/^php-//' \
    | sed 's/\.tar\.(gz|bz2)$//' \
    | sort -V \
    | tail -n 1 || echo 'unknown'
}

fetch_latest_mariadb() {
  curl -fsSL https://mariadb.org/download/ 2>/dev/null \
    | grep -Eo 'MariaDB Server [0-9]+\.[0-9]+\.[0-9]+' \
    | awk '{print $3}' \
    | sort -V \
    | tail -n 1 || echo 'unknown'
}

version_is_lower() {
  local left="$1"
  local right="$2"
  [ -n "$left" ] && [ -n "$right" ] && [ "$left" != "$right" ] && [ "$(printf '%s\n%s\n' "$left" "$right" | sort -V | head -n 1)" = "$left" ]
}

check_component() {
  local name="$1"
  local bundled="$2"
  local latest="$3"

  if [ "$latest" = "unknown" ]; then
    echo "$name: BUNDLED=$bundled, LATEST=unknown, STATUS UNKNOWN"
    return 1
  fi

  if [ "$bundled" = "$latest" ]; then
    echo "$name: BUNDLED=$bundled, LATEST=$latest, STATUS CURRENT"
    return 0
  fi

  if version_is_lower "$bundled" "$latest"; then
    echo "$name: BUNDLED=$bundled, LATEST=$latest, STATUS OUTDATED"
    return 2
  fi

  echo "$name: BUNDLED=$bundled, LATEST=$latest, STATUS CURRENT"
  return 0
}

status=0
check_component "Apache HTTP Server" "$WEEBX_APACHE" "$(fetch_latest_apache)" || status=$?
check_component "PHP x64 NTS" "$WEEBX_PHP" "$(fetch_latest_php)" || status=$?
check_component "MariaDB Server" "$WEEBX_MARIADB" "$(fetch_latest_mariadb)" || status=$?

printf '\n'
if [ "$status" -ne 0 ]; then
  echo "WeebX bundled stack is OUTDATED or needs review."
else
  echo "WeebX bundled stack is CURRENT."
fi

exit 0
