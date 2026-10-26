<?php
declare(strict_types=1);
// WEEBX_HOME_PAGE

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
header("Content-Security-Policy: default-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");

function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$runtime = ['phpProfile' => 'production'];
$runtimeFile = __DIR__ . '/assets/.weebx-runtime.json';
if (is_file($runtimeFile)) {
    $decoded = json_decode((string) file_get_contents($runtimeFile), true);
    if (is_array($decoded)) $runtime = array_merge($runtime, $decoded);
}

$remoteAddress = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
$localRequest = in_array($remoteAddress, ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true);
$development = ($runtime['phpProfile'] ?? 'production') === 'development' && $localRequest;
$phpMyAdmin = is_file(__DIR__ . '/phpmyadmin/index.php');
$extensions = $development ? get_loaded_extensions() : [];
sort($extensions, SORT_NATURAL | SORT_FLAG_CASE);
$featured = ['mysqli', 'pdo_mysql', 'openssl', 'curl', 'mbstring', 'sodium'];
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <title>WeebX <?= $development ? 'development environment' : 'hosting service' ?></title>
    <link rel="icon" href="assets/weebx-logo.png">
    <link rel="stylesheet" href="assets/weebx.css">
</head>
<body>
<main>
    <header class="hero">
        <img src="assets/weebx-logo.png" alt="WeebX">
        <div>
            <span class="eyebrow"><?= $development ? 'DEVELOPMENT ENVIRONMENT' : 'PRODUCTION ENVIRONMENT' ?></span>
            <h1>WeebX is running</h1>
            <?php if ($development): ?>
                <p>Your local web hosting stack manager is ready. Replace this page with your project when you are ready.</p>
                <div class="actions">
                    <?php if ($phpMyAdmin): ?><a class="btn primary" href="/phpmyadmin/">Open phpMyAdmin</a><?php endif; ?>
                    <a class="btn" href="phpinfo.php">PHP info</a>
                </div>
            <?php else: ?>
                <p>This host is using WeebX production defaults. Replace this placeholder with your website.</p>
            <?php endif; ?>
        </div>
    </header>

    <?php if ($development): ?>
        <section class="status-grid">
            <article><small>WEB SERVER</small><h2>Apache</h2><b class="good">Running</b></article>
            <article><small>PHP RUNTIME</small><h2><?= e(PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION) ?></h2><b>Development profile</b></article>
            <article><small>DATABASE</small><h2>MariaDB</h2><b class="good"><?= !empty($runtime['passwordSet']) ? 'Protected' : 'Security setup required' ?></b></article>
            <article><small>PHPMYADMIN</small><h2><?= $phpMyAdmin ? 'Installed' : 'Missing' ?></h2><b><?= $phpMyAdmin ? 'Local access only' : 'Not installed' ?></b></article>
        </section>

        <section class="panel">
            <div class="panel-head"><h2>Loaded PHP modules</h2><small><?= count($extensions) ?> active</small></div>
            <div class="chips">
                <?php foreach ($extensions as $extension): ?>
                    <span class="<?= in_array($extension, $featured, true) ? 'hot' : '' ?>"><?= e($extension) ?></span>
                <?php endforeach; ?>
            </div>
        </section>
    <?php else: ?>
        <section class="status-grid">
            <article><small>STATUS</small><h2>Online</h2><b class="good">Production profile active</b></article>
            <article><small>DIRECTORY LISTING</small><h2>Disabled</h2><b>Protected by default</b></article>
            <article><small>DATABASE</small><h2>MariaDB</h2><b>Loopback access only</b></article>
            <article><small>DIAGNOSTICS</small><h2>Hidden</h2><b>Development only</b></article>
        </section>
    <?php endif; ?>

    <footer>This placeholder contains no credentials, filesystem paths, environment variables, or detailed server version information.</footer>
</main>
</body>
</html>
