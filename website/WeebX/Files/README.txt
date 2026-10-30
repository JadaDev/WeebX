Put the downloads in this folder:

  WeebX-Installer-x64.msi
  WeebX.zip

Only those exact names (plus WeebX-Portable.zip as a ZIP fallback) are served.
Other files are deliberately ignored and direct web access is denied.

Downloads are served through ../download.php so the public counter is updated.
Do not replace the generated website links with direct Files/ links, because
direct links bypass the counter and the terms confirmation.

The PHP/web-server account must be allowed to write:

  ../_data/.download-stats.php

For deployments that keep writable data outside the public website folder, set
WEEBX_DOWNLOAD_STATS_PATH to an absolute writable private counter file path.
