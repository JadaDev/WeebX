<?php
declare(strict_types=1);
// WEEBX_PHPINFO_PAGE

$runtime = [];
$runtimeFile = __DIR__ . '/assets/.weebx-runtime.json';
if (is_file($runtimeFile)) {
    $decoded = json_decode((string) file_get_contents($runtimeFile), true);
    if (is_array($decoded)) $runtime = $decoded;
}

$remoteAddress = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
$localRequest = in_array($remoteAddress, ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true);
if (($runtime['phpProfile'] ?? 'production') !== 'development' || !$localRequest) {
    http_response_code(404);
    header('Cache-Control: no-store');
    exit('Not found.');
}

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");

$version = htmlspecialchars(PHP_VERSION, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
ob_start();
phpinfo(INFO_GENERAL | INFO_CONFIGURATION | INFO_MODULES);
$html = (string) ob_get_clean();

$privatePaths = array_filter([
    dirname(__DIR__), __DIR__, (string) ($_SERVER['DOCUMENT_ROOT'] ?? ''),
    (string) php_ini_loaded_file(), (string) getenv('USERPROFILE'), (string) sys_get_temp_dir(),
]);
usort($privatePaths, static fn(string $a, string $b): int => strlen($b) <=> strlen($a));
foreach (array_unique($privatePaths) as $path) {
    $variants = [$path, str_replace('\\', '/', $path), htmlspecialchars($path, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')];
    $html = str_ireplace(array_unique($variants), '[path hidden]', $html);
}

$css = <<<CSS
<link rel="icon" href="assets/weebx-logo.png"><link rel="stylesheet" href="assets/weebx.css">
<style>body{margin:0;background:#080c17;color:#eef1ff}h1.p,h2.p,td,th,a{font-family:"Segoe UI",sans-serif!important}table{border-color:#25304a!important}td.e{background:#151c2d!important;color:#c4bbff!important}td.v,td.h{background:#101827!important;color:#eef1ff!important}h1,h2{color:#eef1ff!important}</style>
CSS;
$banner = <<<HTML
<div class="phpinfo-bar"><img src="assets/weebx-logo.png" alt="WeebX"><div><strong>Development diagnostics</strong><span>Private paths are redacted · PHP {$version}</span></div><a class="btn" href="./">Back to WeebX</a></div>
HTML;
$html = preg_replace('/<head>/i', '<head>' . $css, $html, 1) ?? $html;
$html = preg_replace('/<body[^>]*>/i', '$0' . $banner, $html, 1) ?? $html;
echo $html;
