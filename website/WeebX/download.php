<?php
declare(strict_types=1);

require_once __DIR__ . DIRECTORY_SEPARATOR . '_internal' . DIRECTORY_SEPARATOR . 'http-security.php';
require_once __DIR__ . DIRECTORY_SEPARATOR . '_internal' . DIRECTORY_SEPARATOR . 'download-stats.php';

sendBrowserSecurityHeaders("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
header('X-Download-Options: noopen');
$method = enforceReadOnlyRequestMethod();

if (($_GET['stats'] ?? '') === '1') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    if ($method !== 'HEAD') echo json_encode(publicDownloadStats(), JSON_UNESCAPED_SLASHES);
    exit;
}

$requested = $_GET['file'] ?? '';
if (!is_string($requested) || !isAllowedDownloadFilename($requested)) {
    http_response_code(400);
    exit('Invalid download request.');
}

$filesRoot = realpath(__DIR__ . DIRECTORY_SEPARATOR . 'Files');
$filePath = realpath(__DIR__ . DIRECTORY_SEPARATOR . 'Files' . DIRECTORY_SEPARATOR . $requested);
if ($filesRoot === false || $filePath === false || !is_file($filePath) || !str_starts_with($filePath, $filesRoot . DIRECTORY_SEPARATOR)) {
    http_response_code(404);
    exit('Download not found.');
}

$size = filesize($filePath);
if ($size === false || $size < 1) {
    http_response_code(500);
    exit('The download could not be read.');
}

$start = 0;
$end = max(0, $size - 1);
$range = $_SERVER['HTTP_RANGE'] ?? '';
if (is_string($range) && $range !== '') {
    if (preg_match('/^bytes=(\d*)-(\d*)$/', trim($range), $parts) !== 1) {
        header('Content-Range: bytes */' . $size);
        http_response_code(416);
        exit;
    }
    if ($parts[1] === '' && $parts[2] !== '') {
        $length = min((int) $parts[2], $size);
        $start = $size - $length;
    } else {
        $start = (int) $parts[1];
        if ($parts[2] !== '') $end = min((int) $parts[2], $end);
    }
    if ($start < 0 || $start > $end || $start >= $size) {
        header('Content-Range: bytes */' . $size);
        http_response_code(416);
        exit;
    }
    http_response_code(206);
    header("Content-Range: bytes {$start}-{$end}/{$size}");
}

if ($method !== 'HEAD') {
    registerDownload($requested, downloadVisitorId());
}

$contentType = str_ends_with(strtolower($requested), '.msi') ? 'application/x-msi' : 'application/zip';
$safeAsciiName = preg_replace('/[^A-Za-z0-9._-]/', '_', $requested) ?: 'WeebX-download';
header('Content-Type: ' . $contentType);
header('Content-Disposition: attachment; filename="' . $safeAsciiName . '"; filename*=UTF-8\'\'' . rawurlencode($requested));
header('Accept-Ranges: bytes');
header('Content-Length: ' . (($end - $start) + 1));
header('Cache-Control: private, no-transform');

if ($method === 'HEAD') exit;

$handle = fopen($filePath, 'rb');
if ($handle === false) {
    http_response_code(500);
    exit;
}
set_time_limit(0);
fseek($handle, $start);
$remaining = ($end - $start) + 1;
while ($remaining > 0 && !feof($handle)) {
    $chunk = fread($handle, min(1048576, $remaining));
    if ($chunk === false || $chunk === '') break;
    echo $chunk;
    $remaining -= strlen($chunk);
    flush();
    if (connection_aborted()) break;
}
fclose($handle);
