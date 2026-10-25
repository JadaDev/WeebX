<?php
declare(strict_types=1);
// WEEBX_HOME_PAGE

function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$runtime = [
    'apachePort' => 80,
    'apacheSslPort' => 443,
    'mariadbPort' => 3306,
    'phpVersion' => PHP_VERSION,
];
$runtimeFile = __DIR__ . '/assets/weebx-runtime.json';
if (is_file($runtimeFile)) {
    $decoded = json_decode((string) file_get_contents($runtimeFile), true);
    if (is_array($decoded)) {
        $runtime = array_merge($runtime, $decoded);
    }
}

$mariadbPort = (int) ($runtime['mariadbPort'] ?? 3306);
$passwordSet = !empty($runtime['passwordSet']);
$phpMyAdmin = is_file(__DIR__ . '/phpmyadmin/index.php');
$extensions = get_loaded_extensions();
sort($extensions, SORT_NATURAL | SORT_FLAG_CASE);
$featured = ['mysqli', 'pdo_mysql', 'openssl', 'curl', 'mbstring', 'gd', 'zip', 'intl', 'fileinfo', 'exif'];
$ini = static fn(string $key): string => (string) ini_get($key);

$databaseOk = false;
$databaseVersion = '';
$databaseError = 'MySQL is not running';
if ($passwordSet) {
    $databaseOk = true;
    $databaseVersion = 'Password set in WeebX';
} elseif (extension_loaded('mysqli')) {
    mysqli_report(MYSQLI_REPORT_OFF);
    try {
        $database = mysqli_init();
        if ($database instanceof mysqli) {
            $database->options(MYSQLI_OPT_CONNECT_TIMEOUT, 1);
            $databaseOk = @$database->real_connect('127.0.0.1', 'root', '', '', $mariadbPort);
            if ($databaseOk) {
                $databaseVersion = (string) $database->server_info;
                $database->close();
            } else {
                $databaseError = $database->connect_error ?: 'Start MySQL in WeebX';
            }
        }
    } catch (Throwable $error) {
        $databaseOk = false;
        $databaseError = $error->getMessage();
    }
} else {
    $databaseError = 'mysqli is not loaded';
}

$projects = [];
foreach (scandir(__DIR__) ?: [] as $entry) {
    if ($entry === '.' || $entry === '..' || in_array($entry, ['assets', 'phpmyadmin'], true)) {
        continue;
    }
    if (is_dir(__DIR__ . DIRECTORY_SEPARATOR . $entry)) {
        $projects[] = $entry;
    }
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WeebX — Local stack is running</title>
    <link rel="icon" href="assets/weebx-logo.png">
    <link rel="stylesheet" href="assets/weebx.css">
</head>
<body>
<main>
    <header class="hero">
        <img src="assets/weebx-logo.png" alt="WeebX">
        <div>
            <span class="eyebrow">LOCAL DEVELOPMENT STACK</span>
            <h1>WeebX is running</h1>
            <p>Apache is serving this folder with PHP <strong><?= e(PHP_VERSION) ?></strong>. Use phpMyAdmin for databases, or replace this page with your own site.</p>
            <div class="actions">
                <?php if ($phpMyAdmin): ?>
                    <a class="btn primary" href="/phpmyadmin/">Open phpMyAdmin</a>
                <?php else: ?>
                    <span class="btn disabled">phpMyAdmin not installed</span>
                <?php endif; ?>
                <a class="btn" href="phpinfo.php">PHP info</a>
            </div>
        </div>
    </header>

    <section class="status-grid">
        <article>
            <small>WEB SERVER</small>
            <h2>Apache</h2>
            <b class="good">Running</b>
        </article>
        <article>
            <small>PHP RUNTIME</small>
            <h2><?= e(PHP_VERSION) ?></h2>
            <b><?= PHP_ZTS ? 'Thread Safe' : 'Non Thread Safe' ?></b>
        </article>
        <article>
            <small>DATABASE</small>
            <h2>MySQL</h2>
            <b class="<?= $databaseOk ? 'good' : 'wait' ?>"><?= e($databaseOk ? ($databaseVersion ?: 'MariaDB connected') : $databaseError) ?></b>
        </article>
        <article>
            <small>PHPMYADMIN</small>
            <h2><?= $phpMyAdmin ? 'Installed' : 'Missing' ?></h2>
            <b class="<?= $phpMyAdmin ? 'good' : 'wait' ?>"><?= $phpMyAdmin ? 'Ready at /phpmyadmin' : 'Not in htdocs' ?></b>
        </article>
    </section>

    <section class="columns">
        <article class="panel">
            <div class="panel-head">
                <h2>PHP information</h2>
                <a href="phpinfo.php">Full phpinfo()</a>
            </div>
            <div class="facts">
                <div><span>Version</span><b><?= e(PHP_VERSION) ?></b></div>
                <div><span>SAPI</span><b><?= e(PHP_SAPI) ?></b></div>
                <div><span>Zend Engine</span><b><?= e(zend_version()) ?></b></div>
                <div><span>Architecture</span><b><?= PHP_INT_SIZE * 8 ?>-bit <?= PHP_ZTS ? 'TS' : 'NTS' ?></b></div>
                <div><span>Loaded php.ini</span><code><?= e(php_ini_loaded_file() ?: 'none') ?></code></div>
                <div><span>Server API software</span><code><?= e((string) ($_SERVER['SERVER_SOFTWARE'] ?? 'Apache')) ?></code></div>
                <div><span>memory_limit</span><b><?= e($ini('memory_limit')) ?></b></div>
                <div><span>max_execution_time</span><b><?= e($ini('max_execution_time')) ?>s</b></div>
                <div><span>upload_max_filesize</span><b><?= e($ini('upload_max_filesize')) ?></b></div>
                <div><span>post_max_size</span><b><?= e($ini('post_max_size')) ?></b></div>
                <div><span>display_errors</span><b><?= e($ini('display_errors')) ?></b></div>
                <div><span>date.timezone</span><b><?= e($ini('date.timezone') ?: 'not set') ?></b></div>
            </div>
        </article>
        <article class="panel">
            <div class="panel-head"><h2>MySQL login</h2></div>
            <div class="cred">
                <div><span>Host</span><code>127.0.0.1</code></div>
                <div><span>Port</span><code><?= e((string) $mariadbPort) ?></code></div>
                <div><span>User</span><code>root</code></div>
                <div><span>Password</span><code><?= $passwordSet ? 'set in WeebX' : '(empty)' ?></code></div>
            </div>
            <p class="note">Change the password in WeebX Settings. phpMyAdmin and your apps use <code>root</code> on <code>127.0.0.1</code> / <code>localhost</code>.</p>
        </article>
    </section>

    <section class="panel">
        <div class="panel-head">
            <h2>Loaded PHP modules</h2>
            <small><?= count($extensions) ?> active</small>
        </div>
        <div class="chips">
            <?php foreach ($extensions as $extension): ?>
                <span class="<?= in_array($extension, $featured, true) ? 'hot' : '' ?>"><?= e($extension) ?></span>
            <?php endforeach; ?>
        </div>
    </section>

    <?php if ($projects): ?>
        <section class="panel" style="margin-top:16px">
            <div class="panel-head"><h2>Folders in htdocs</h2></div>
            <div class="projects">
                <?php foreach ($projects as $project): ?>
                    <a href="/<?= e(rawurlencode($project)) ?>/"><?= e($project) ?></a>
                <?php endforeach; ?>
            </div>
        </section>
    <?php endif; ?>

    <footer>
        Document root: <code><?= e((string) ($_SERVER['DOCUMENT_ROOT'] ?? __DIR__)) ?></code><br>
        This default WeebX page can be replaced. Your other project files are left untouched.
    </footer>
</main>
</body>
</html>
