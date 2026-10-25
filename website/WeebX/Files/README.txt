Put the downloads in this folder:

  WeebX-Installer-x64.msi
  WeebX.zip

The page looks for those names first. Any other .msi / .zip in here also works
(newest file wins if the preferred name is missing).

Downloads are served through ../download.php so the public counter is updated.
Do not replace the generated website links with direct Files/ links, because
direct links bypass the counter and the terms confirmation.

The PHP/web-server account must be allowed to write:

  ../_data/.download-stats.json

For deployments that keep writable data outside the public website folder, set
WEEBX_DOWNLOAD_STATS_PATH to an absolute writable JSON file path.
