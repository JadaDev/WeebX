<?php
declare(strict_types=1);

const WEEBX_DOWNLOAD_COOKIE = 'weebx_download_id';
const WEEBX_STATS_FILE_PREFIX = "<?php header_remove('X-Powered-By'); header(\"X-Content-Type-Options: nosniff\"); header(\"Content-Security-Policy: default-src 'none'\"); http_response_code(404); exit; ?>\n";
const WEEBX_MAX_STATS_BYTES = 8388608;
const WEEBX_MAX_STORED_VISITORS = 10000;
const WEEBX_PRUNED_VISITORS = 7500;
const WEEBX_DOWNLOAD_FILENAMES = [
    'WeebX-Installer-x64.msi',
    'WeebX.zip',
    'WeebX-Portable.zip',
];

function isAllowedDownloadFilename(string $filename): bool
{
    return in_array($filename, WEEBX_DOWNLOAD_FILENAMES, true);
}

function downloadStatsPath(): string
{
    $configured = getenv('WEEBX_DOWNLOAD_STATS_PATH');
    if (is_string($configured) && $configured !== '') {
        return $configured;
    }
    return defaultDownloadStatsPath();
}

function defaultDownloadStatsPath(): string
{
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . '_data' . DIRECTORY_SEPARATOR . '.download-stats.php';
}

function legacyDownloadStatsPath(): string
{
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . '_data' . DIRECTORY_SEPARATOR . '.download-stats.json';
}

function decodeDownloadStats(string $raw): mixed
{
    if (str_starts_with($raw, WEEBX_STATS_FILE_PREFIX)) {
        $raw = substr($raw, strlen(WEEBX_STATS_FILE_PREFIX));
    }
    return $raw !== '' ? json_decode($raw, true, 32) : null;
}

function readLegacyDownloadStats(): ?array
{
    $path = legacyDownloadStatsPath();
    $size = @filesize($path);
    if (!is_file($path) || $size === false || $size > WEEBX_MAX_STATS_BYTES) return null;
    $raw = @file_get_contents($path);
    return is_string($raw) ? normalizeDownloadStats(decodeDownloadStats($raw)) : null;
}

function shouldUseLegacyDownloadStats(array $current, ?array $legacy): bool
{
    return $legacy !== null
        && (int) $current['uniqueDownloads'] === 0
        && (int) $current['downloadStarts'] === 0
        && ((int) $legacy['uniqueDownloads'] > 0 || (int) $legacy['downloadStarts'] > 0);
}

function normalizeVisitors(mixed $value): array
{
    if (!is_array($value)) return [];
    $visitors = [];
    foreach ($value as $hash => $timestamp) {
        if (count($visitors) >= WEEBX_MAX_STORED_VISITORS) break;
        if (!is_string($hash) || preg_match('/^[a-f0-9]{64}$/', $hash) !== 1 || !is_string($timestamp) || strlen($timestamp) > 40) continue;
        $visitors[$hash] = $timestamp;
    }
    return $visitors;
}

function emptyDownloadStats(): array
{
    return [
        'uniqueDownloads' => 0,
        'downloadStarts' => 0,
        'visitors' => [],
        'files' => [],
        'updatedAt' => null,
    ];
}

function normalizeDownloadStats(mixed $value): array
{
    $stats = emptyDownloadStats();
    if (!is_array($value)) return $stats;
    $stats['uniqueDownloads'] = max(0, (int) ($value['uniqueDownloads'] ?? 0));
    $stats['downloadStarts'] = max(0, (int) ($value['downloadStarts'] ?? 0));
    $stats['visitors'] = normalizeVisitors($value['visitors'] ?? null);
    $files = is_array($value['files'] ?? null) ? $value['files'] : [];
    foreach ($files as $name => $file) {
        if (!is_string($name) || !isAllowedDownloadFilename($name) || !is_array($file)) continue;
        $stats['files'][$name] = [
            'downloads' => max(0, (int) ($file['downloads'] ?? 0)),
            'starts' => max(0, (int) ($file['starts'] ?? 0)),
            'visitors' => normalizeVisitors($file['visitors'] ?? null),
            'lastDownloadAt' => is_string($file['lastDownloadAt'] ?? null) && strlen($file['lastDownloadAt']) <= 40 ? $file['lastDownloadAt'] : null,
        ];
    }
    $stats['updatedAt'] = is_string($value['updatedAt'] ?? null) ? $value['updatedAt'] : null;
    return $stats;
}

function readDownloadStats(): array
{
    $path = downloadStatsPath();
    if (!is_file($path) && $path === defaultDownloadStatsPath() && is_file(legacyDownloadStatsPath())) {
        $path = legacyDownloadStatsPath();
    }
    $handle = @fopen($path, 'c+');
    if ($handle === false) return emptyDownloadStats();
    try {
        if (!flock($handle, LOCK_SH)) return emptyDownloadStats();
        $metadata = fstat($handle);
        if (is_array($metadata) && (int) ($metadata['size'] ?? 0) > WEEBX_MAX_STATS_BYTES) {
            flock($handle, LOCK_UN);
            return emptyDownloadStats();
        }
        rewind($handle);
        $raw = stream_get_contents($handle);
        flock($handle, LOCK_UN);
        $stats = normalizeDownloadStats(is_string($raw) ? decodeDownloadStats($raw) : null);
        if ($path === defaultDownloadStatsPath()) {
            $legacy = readLegacyDownloadStats();
            if (shouldUseLegacyDownloadStats($stats, $legacy)) return $legacy;
        }
        return $stats;
    } finally {
        fclose($handle);
    }
}

function publicDownloadStats(?array $stats = null): array
{
    $stats ??= readDownloadStats();
    $files = [];
    foreach ($stats['files'] as $name => $file) {
        if (!is_string($name) || !is_array($file)) continue;
        $files[$name] = [
            'downloads' => max(0, (int) ($file['downloads'] ?? 0)),
            'starts' => max(0, (int) ($file['starts'] ?? 0)),
        ];
    }
    return [
        'uniqueDownloads' => max(0, (int) $stats['uniqueDownloads']),
        'downloadStarts' => max(0, (int) $stats['downloadStarts']),
        'files' => $files,
        'updatedAt' => $stats['updatedAt'],
    ];
}

function downloadVisitorId(): string
{
    $saved = $_COOKIE[WEEBX_DOWNLOAD_COOKIE] ?? '';
    if (is_string($saved) && preg_match('/^[a-f0-9]{32}$/', $saved) === 1) return $saved;
    $visitorId = bin2hex(random_bytes(16));
    $cookiePath = (string) ($_SERVER['SCRIPT_NAME'] ?? '/download.php');
    if ($cookiePath === '' || $cookiePath[0] !== '/' || !str_ends_with(strtolower($cookiePath), '/download.php')) $cookiePath = '/download.php';
    setcookie(WEEBX_DOWNLOAD_COOKIE, $visitorId, [
        'expires' => time() + 31536000,
        'path' => $cookiePath,
        'secure' => function_exists('isSecureRequest') ? isSecureRequest() : (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    return $visitorId;
}

function registerDownload(string $filename, string $visitorId): array
{
    if (!isAllowedDownloadFilename($filename) || preg_match('/^[a-f0-9]{32}$/', $visitorId) !== 1) return emptyDownloadStats();
    $path = downloadStatsPath();
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) return emptyDownloadStats();
    $handle = @fopen($path, 'c+');
    if ($handle === false) return emptyDownloadStats();

    try {
        if (!flock($handle, LOCK_EX)) return emptyDownloadStats();
        rewind($handle);
        $raw = stream_get_contents($handle);
        $stats = normalizeDownloadStats(is_string($raw) ? decodeDownloadStats($raw) : null);
        if ($path === defaultDownloadStatsPath()) {
            $legacy = readLegacyDownloadStats();
            if (shouldUseLegacyDownloadStats($stats, $legacy)) $stats = $legacy;
        }
        $visitorHash = hash('sha256', $visitorId);
        $now = gmdate('c');

        // Keep the anonymous counter bounded so forged cookies cannot grow the
        // on-disk JSON file forever. Old identifiers are not needed for totals.
        if (count($stats['visitors']) >= WEEBX_MAX_STORED_VISITORS) {
            asort($stats['visitors']);
            $stats['visitors'] = array_slice($stats['visitors'], -WEEBX_PRUNED_VISITORS, null, true);
        }

        $stats['downloadStarts']++;
        if (!isset($stats['visitors'][$visitorHash])) {
            $stats['visitors'][$visitorHash] = $now;
            $stats['uniqueDownloads']++;
        }

        $file = is_array($stats['files'][$filename] ?? null) ? $stats['files'][$filename] : ['downloads' => 0, 'starts' => 0, 'visitors' => []];
        $file['visitors'] = is_array($file['visitors'] ?? null) ? $file['visitors'] : [];
        if (count($file['visitors']) >= WEEBX_MAX_STORED_VISITORS) {
            asort($file['visitors']);
            $file['visitors'] = array_slice($file['visitors'], -WEEBX_PRUNED_VISITORS, null, true);
        }
        $file['starts'] = max(0, (int) ($file['starts'] ?? 0)) + 1;
        $file['downloads'] = max(0, (int) ($file['downloads'] ?? 0));
        if (!isset($file['visitors'][$visitorHash])) {
            $file['visitors'][$visitorHash] = $now;
            $file['downloads']++;
        }
        $file['lastDownloadAt'] = $now;
        $stats['files'][$filename] = $file;
        $stats['updatedAt'] = $now;

        $encoded = json_encode($stats, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if (is_string($encoded)) {
            rewind($handle);
            ftruncate($handle, 0);
            fwrite($handle, WEEBX_STATS_FILE_PREFIX . $encoded . PHP_EOL);
            fflush($handle);
            if ($path === defaultDownloadStatsPath() && is_file(legacyDownloadStatsPath())) @unlink(legacyDownloadStatsPath());
        }
        flock($handle, LOCK_UN);
        return $stats;
    } finally {
        fclose($handle);
    }
}
