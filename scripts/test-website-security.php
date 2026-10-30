<?php
declare(strict_types=1);

$root = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'website' . DIRECTORY_SEPARATOR . 'WeebX';
$temporary = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'weebx-website-security-' . bin2hex(random_bytes(8)) . '.php';
putenv('WEEBX_DOWNLOAD_STATS_PATH=' . $temporary);
$_SERVER['SCRIPT_NAME'] = '/download.php';
$_SERVER['REQUEST_METHOD'] = 'GET';

require_once $root . DIRECTORY_SEPARATOR . '_internal' . DIRECTORY_SEPARATOR . 'http-security.php';
require_once $root . DIRECTORY_SEPARATOR . '_internal' . DIRECTORY_SEPARATOR . 'download-stats.php';

function checkWebsiteSecurity(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

try {
    checkWebsiteSecurity(isAllowedDownloadFilename('WeebX-Installer-x64.msi'), 'Expected MSI was rejected.');
    checkWebsiteSecurity(!isAllowedDownloadFilename('../WeebX-Installer-x64.msi'), 'Traversal filename was accepted.');
    checkWebsiteSecurity(!isAllowedDownloadFilename("WeebX.zip\r\nX-Test: injected"), 'Header injection filename was accepted.');

    $first = registerDownload('WeebX-Installer-x64.msi', str_repeat('a', 32));
    checkWebsiteSecurity($first['uniqueDownloads'] === 1, 'First unique download was not counted.');
    checkWebsiteSecurity($first['files']['WeebX-Installer-x64.msi']['downloads'] === 1, 'Per-file download was not counted.');

    $second = registerDownload('WeebX-Installer-x64.msi', str_repeat('a', 32));
    checkWebsiteSecurity($second['uniqueDownloads'] === 1, 'Repeat visitor inflated the unique count.');
    checkWebsiteSecurity(registerDownload('../bad.zip', str_repeat('b', 32))['uniqueDownloads'] === 0, 'Invalid filename reached storage.');

    $stored = file_get_contents($temporary);
    checkWebsiteSecurity(is_string($stored) && str_starts_with($stored, WEEBX_STATS_FILE_PREFIX), 'Counter file is not PHP guarded.');
    checkWebsiteSecurity(publicDownloadStats($second)['uniqueDownloads'] === 1, 'Public stats projection is incorrect.');
    checkWebsiteSecurity(!isset(publicDownloadStats($second)['visitors']), 'Public stats leaked visitor hashes.');
    echo "Website security self-test passed.\n";
} finally {
    @unlink($temporary);
    putenv('WEEBX_DOWNLOAD_STATS_PATH');
}
