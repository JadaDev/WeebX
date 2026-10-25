<?php
declare(strict_types=1);

const WEEBX_DOWNLOAD_COOKIE = 'weebx_download_id';

function downloadStatsPath(): string
{
    $configured = getenv('WEEBX_DOWNLOAD_STATS_PATH');
    if (is_string($configured) && $configured !== '') {
        return $configured;
    }
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . '_data' . DIRECTORY_SEPARATOR . '.download-stats.json';
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
    $stats['visitors'] = is_array($value['visitors'] ?? null) ? $value['visitors'] : [];
    $stats['files'] = is_array($value['files'] ?? null) ? $value['files'] : [];
    $stats['updatedAt'] = is_string($value['updatedAt'] ?? null) ? $value['updatedAt'] : null;
    return $stats;
}

function readDownloadStats(): array
{
    $path = downloadStatsPath();
    $handle = @fopen($path, 'c+');
    if ($handle === false) return emptyDownloadStats();
    try {
        if (!flock($handle, LOCK_SH)) return emptyDownloadStats();
        rewind($handle);
        $raw = stream_get_contents($handle);
        flock($handle, LOCK_UN);
        return normalizeDownloadStats(is_string($raw) && $raw !== '' ? json_decode($raw, true) : null);
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
    setcookie(WEEBX_DOWNLOAD_COOKIE, $visitorId, [
        'expires' => time() + 31536000,
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    return $visitorId;
}

function registerDownload(string $filename, string $visitorId): array
{
    $path = downloadStatsPath();
    $directory = dirname($path);
    if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) return emptyDownloadStats();
    $handle = @fopen($path, 'c+');
    if ($handle === false) return emptyDownloadStats();

    try {
        if (!flock($handle, LOCK_EX)) return emptyDownloadStats();
        rewind($handle);
        $raw = stream_get_contents($handle);
        $stats = normalizeDownloadStats(is_string($raw) && $raw !== '' ? json_decode($raw, true) : null);
        $visitorHash = hash('sha256', $visitorId);
        $now = gmdate('c');

        $stats['downloadStarts']++;
        if (!isset($stats['visitors'][$visitorHash])) {
            $stats['visitors'][$visitorHash] = $now;
            $stats['uniqueDownloads']++;
        }

        $file = is_array($stats['files'][$filename] ?? null) ? $stats['files'][$filename] : ['downloads' => 0, 'starts' => 0, 'visitors' => []];
        $file['visitors'] = is_array($file['visitors'] ?? null) ? $file['visitors'] : [];
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
            fwrite($handle, $encoded . PHP_EOL);
            fflush($handle);
        }
        flock($handle, LOCK_UN);
        return $stats;
    } finally {
        fclose($handle);
    }
}
