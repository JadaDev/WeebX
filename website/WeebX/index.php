<?php
declare(strict_types=1);

require_once __DIR__ . DIRECTORY_SEPARATOR . '_internal' . DIRECTORY_SEPARATOR . 'download-stats.php';

$cspNonce = base64_encode(random_bytes(18));
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: DENY');
header('Cross-Origin-Opener-Policy: same-origin');
header('Cross-Origin-Resource-Policy: same-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{$cspNonce}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') header('Strict-Transport-Security: max-age=31536000; includeSubDomains');

function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function pickDownload(string $dir, string $extension, array $preferred = []): ?array
{
    if (!is_dir($dir)) {
        return null;
    }
    foreach ($preferred as $name) {
        $path = $dir . DIRECTORY_SEPARATOR . $name;
        if (is_file($path)) {
            return describeDownload($path);
        }
    }
    $matches = array_values(array_filter(glob($dir . DIRECTORY_SEPARATOR . '*.' . $extension) ?: [], 'is_file'));
    if (!$matches) {
        return null;
    }
    usort($matches, static fn(string $a, string $b): int => filemtime($b) <=> filemtime($a));
    return describeDownload($matches[0]);
}

function describeDownload(string $path): array
{
    return [
        'name' => basename($path),
        'href' => 'download.php?file=' . rawurlencode(basename($path)),
        'size' => formatSize((int) filesize($path)),
        'mtime' => date('Y-m-d', (int) filemtime($path)),
    ];
}

function formatSize(int $bytes): string
{
    if ($bytes < 1024) return $bytes . ' B';
    if ($bytes < 1048576) return number_format($bytes / 1024, 1) . ' KB';
    if ($bytes < 1073741824) return number_format($bytes / 1048576, 1) . ' MB';
    return number_format($bytes / 1073741824, 2) . ' GB';
}

function assetUrl(string $relativePath): string
{
    $fullPath = __DIR__ . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
    $version = is_file($fullPath) ? (string) filemtime($fullPath) : '1';
    return $relativePath . '?v=' . rawurlencode($version);
}

$version = '2.0.5';
$filesDir = __DIR__ . DIRECTORY_SEPARATOR . 'Files';
$msi = pickDownload($filesDir, 'msi', ['WeebX-Installer-x64.msi']);
$zip = pickDownload($filesDir, 'zip', ['WeebX.zip', 'WeebX-Portable.zip']);
$downloadStats = publicDownloadStats();
$uniqueDownloads = (int) $downloadStats['uniqueDownloads'];
?>
<!doctype html>
<html lang="en" class="no-js">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script nonce="<?= e($cspNonce) ?>">document.documentElement.classList.replace('no-js', 'js')</script>
    <title>WeebX — Modern XAMPP Alternative for Windows</title>
    <meta name="description" content="Download WeebX, a modern XAMPP alternative for Windows with Apache, MariaDB and patched PHP 8.2.35, 8.3.36, 8.4.27 and 8.5.12 runtimes.">
    <meta name="keywords" content="WeebX, local web hosting stack manager, XAMPP alternative, Windows web server, Apache, PHP, MariaDB, phpMyAdmin">
    <meta name="author" content="JadaDev">
    <meta name="application-name" content="WeebX">
    <meta name="robots" content="index, follow, max-image-preview:large">
    <meta name="theme-color" content="#090d18">
    <meta name="color-scheme" content="dark">
    <link rel="canonical" href="https://weebx.jadadev.com/">
    <link rel="icon" type="image/png" href="assets/weebx-logo.png">
    <link rel="apple-touch-icon" href="assets/weebx-logo.png">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="WeebX">
    <meta property="og:title" content="WeebX — Local Web Hosting Stack Manager">
    <meta property="og:description" content="A polished XAMPP alternative with four patched PHP runtimes, Apache, MariaDB, module controls, and crash recovery.">
    <meta property="og:url" content="https://weebx.jadadev.com/">
    <meta property="og:image" content="https://weebx.jadadev.com/assets/weebx-logo.png">
    <meta property="og:image:alt" content="WeebX blue and violet logo">
    <meta property="og:image:width" content="1280">
    <meta property="og:image:height" content="1280">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="WeebX — Modern XAMPP Alternative for Windows">
    <meta name="twitter:description" content="Apache, MariaDB and patched PHP 8.2.35 through 8.5.12 in one focused Windows app.">
    <meta name="twitter:image" content="https://weebx.jadadev.com/assets/weebx-logo.png">
    <link rel="stylesheet" href="<?= e(assetUrl('assets/style.css')) ?>">
    <script type="application/ld+json" nonce="<?= e($cspNonce) ?>">
    {"@context":"https://schema.org","@type":"SoftwareApplication","name":"WeebX","applicationCategory":"DeveloperApplication","operatingSystem":"Windows 10, Windows 11","softwareVersion":"<?= e($version) ?>","description":"A local web hosting stack manager with Apache, PHP and MariaDB for Windows.","url":"https://weebx.jadadev.com/","image":"https://weebx.jadadev.com/assets/weebx-logo.png","author":{"@type":"Organization","name":"JadaDev"},"offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}
    </script>
    <script src="<?= e(assetUrl('assets/site.js')) ?>" defer></script>
</head>
<body>
<div class="site-loader" aria-hidden="true">
    <div class="loader-mark"><span></span><img src="assets/weebx-logo.png" alt=""></div>
    <p>Preparing your workspace</p>
</div>

<header class="topbar">
    <a class="brand" href="#top" aria-label="WeebX home">
        <img src="assets/weebx-logo.png" alt="WeebX logo">
        <span><strong>WeebX</strong><small>Hosting Stack Manager</small></span>
    </a>
    <nav aria-label="Primary navigation">
        <a href="#features">Features</a>
        <a href="#stack">Stack</a>
        <a href="#security">Security</a>
        <a href="#download">Download</a>
        <a href="#legal">Legal</a>
    </nav>
    <a class="nav-github" href="https://github.com/JadaDev/WeebX" rel="noopener noreferrer">View on GitHub <span>↗</span></a>
</header>

<main id="top">
    <section class="hero section-shell">
        <div class="hero-copy">
            <span class="eyebrow"><i></i> BUILT FOR WINDOWS HOSTING</span>
            <h1>Local Web Hosting<br><em>Stack Manager.</em></h1>
            <p class="lead">Run Apache, PHP, MariaDB and phpMyAdmin from one focused control panel—with a development-first workflow, a hardened Live / Production profile, virtual hosts, safer updates, and automatic crash recovery.</p>
            <div class="hero-actions">
                <?php if ($msi): ?>
                    <a class="button primary download-trigger" href="<?= e($msi['href']) ?>" data-file="<?= e($msi['name']) ?>">Download for Windows <span>↓</span></a>
                <?php else: ?>
                    <span class="button primary disabled">Installer coming soon</span>
                <?php endif; ?>
                <a class="button ghost" href="#features">Explore features</a>
            </div>
            <div class="trust-row"><span>✓ Free &amp; open source</span><span>✓ Windows 10/11 x64</span><span>✓ Version <?= e($version) ?></span><span class="download-proof"><b data-download-count><?= number_format($uniqueDownloads) ?></b> developers downloaded WeebX</span></div>
        </div>

        <figure class="product-preview" aria-label="WeebX dashboard preview">
            <div class="preview-glow"></div>
            <div class="preview-window">
                <div class="preview-bar"><i></i><i></i><i></i><span>WeebX Control Panel</span></div>
                <div class="preview-body">
                    <aside><img src="assets/weebx-logo.png" alt=""><span></span><span></span><span></span><span></span></aside>
                    <div class="preview-main">
                        <div class="preview-title"><div><small>LOCAL WEB HOSTING STACK MANAGER</small><b>Dashboard</b></div><span>● Standard</span></div>
                        <div class="preview-hero"><div class="preview-hero-copy"><small>HOSTING CONTROL PLANE</small><strong>Local Web Hosting<br><em>Stack Manager.</em></strong><div><i>Start all</i><i>Stop all</i></div></div><div class="preview-mini-orb"><b>2</b><small>RUNNING</small><em>2/2</em><i></i><i></i></div></div>
                        <div class="preview-services"><div><span>APACHE HTTP SERVER</span><b>Running</b><small>2.4.69 · :80 · PID 4380</small></div><div><span>MARIADB SERVER</span><b>Running</b><small>12.3.3 · :3306 · PID 5312</small></div></div>
                    </div>
                </div>
            </div>
            <figcaption>One calm control plane for your complete hosting stack.</figcaption>
        </figure>
    </section>

    <section class="signal-strip" aria-label="Included technologies">
        <span>Apache 2.4.69</span><i></i><span>PHP 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12</span><i></i><span>MariaDB 12.3.3</span><i></i><span>phpMyAdmin 5.2.3</span><i></i><span>Virtual Hosts</span>
    </section>

    <section id="features" class="section-shell content-section">
        <div class="section-heading"><span>EVERYTHING IN ONE PLACE</span><h2>Web hosting without the friction.</h2><p>Develop locally, then run production websites from the same focused Windows control plane.</p></div>
        <div class="feature-grid">
            <article class="feature-card featured"><div class="feature-icon">◫</div><span>CONTROL</span><h3>Start, stop, recover.</h3><p>Manage Apache and MariaDB independently or together. Optional crash recovery restarts either service after the delay you choose.</p><div class="mini-service-pair"><div class="mini-status"><i></i><b>Apache is running</b><small>2.4.69 · Auto-restart on</small></div><div class="mini-status"><i></i><b>MariaDB is running</b><small>12.3.3 · Loopback only</small></div></div></article>
            <article class="feature-card"><div class="feature-icon">&lt;/&gt;</div><span>PHP</span><h3>Switch versions cleanly.</h3><p>Use bundled builds, discover new official x64 NTS releases automatically, or validate and import your own PHP ZIP.</p></article>
            <article class="feature-card"><div class="feature-icon">⌂</div><span>SITES</span><h3>Virtual hosts in minutes.</h3><p>Create local domains, project folders, HTTPS certificates, aliases, and hosts-file mappings from one form.</p></article>
            <article class="feature-card"><div class="feature-icon">⌁</div><span>PORTABLE</span><h3>Your projects stay yours.</h3><p>Keep websites and MariaDB data through normal updates, or pack the whole environment when you need to move it.</p></article>
            <article class="feature-card"><div class="feature-icon">⚙</div><span>MODULES</span><h3>Configure visually.</h3><p>Search and toggle PHP and Apache modules, edit core configuration, and validate changes before they go live.</p></article>
            <article class="feature-card"><div class="feature-icon">◎</div><span>VISIBILITY</span><h3>Know what happened.</h3><p>Inspect ports and detailed service logs. Intentional shutdowns stay informational; genuine failures retain diagnostics.</p></article>
            <article class="feature-card"><div class="feature-icon">⌾</div><span>SECURITY</span><h3>Safe defaults, visible choices.</h3><p>Switch from Development to Live / Production, see password severity by environment, and apply guided NTFS permission presets.</p></article>
        </div>
    </section>

    <section class="section-shell php-manager-showcase" aria-label="WeebX PHP version manager preview">
        <div class="section-heading"><span>PHP VERSION CONTROL</span><h2>Install, validate, and switch<br>without rebuilding your stack.</h2><p>The preview mirrors the real WeebX 2.0.5 PHP manager: isolated versions, environment profiles, official release discovery, and guided manual import.</p></div>
        <figure class="php-manager-window">
            <div class="php-shot-head"><div><small>PHP RUNTIME</small><b>PHP versions</b></div><button>+ Add PHP version</button><div class="php-shot-profile"><span class="active">Development</span><span>Live / Production</span></div><em>Active <b>8.5.12</b></em></div>
            <div class="php-shot-list">
                <article><strong>8.2<small>.35</small></strong><div><b>PHP 8.2.35</b><span>Installed · isolated php.ini and extensions</span></div><button>Use this version</button></article>
                <article><strong>8.3<small>.36</small></strong><div><b>PHP 8.3.36</b><span>Installed · isolated php.ini and extensions</span></div><button>Use this version</button></article>
                <article><strong>8.4<small>.27</small></strong><div><b>PHP 8.4.27</b><span>Installed · isolated php.ini and extensions</span></div><button>Use this version</button></article>
                <article class="selected"><strong>8.5<small>.12</small></strong><div><b>PHP 8.5.12</b><span>Installed · official Windows x64 NTS</span></div><i>✓ Active</i><button disabled>In use</button></article>
            </div>
            <figcaption><span>Automatic</span> reads official PHP Windows metadata and verifies SHA-256. <span>Manual / advanced</span> validates PHP 8.2+, x64, NTS, CGI, and extensions before installation.</figcaption>
        </figure>
    </section>

    <section id="stack" class="section-shell stack-section">
        <div class="stack-copy"><span class="eyebrow"><i></i> CURRENT RUNTIME</span><h2>A complete stack.<br><em>Ready when you are.</em></h2><p>WeebX brings the familiar local-server pieces together without hiding their configuration files or locking your work into a proprietary format. MariaDB is the community-developed open-source fork of MySQL; it keeps the familiar protocol and PHP drivers while WeebX uses the accurate MariaDB name throughout the interface.</p><ul><li>Multiple supported PHP versions</li><li>Apache module and php.ini controls</li><li>MariaDB credentials and port management</li><li>Built-in phpMyAdmin access</li></ul></div>
        <div class="stack-grid">
            <article><small>WEB SERVER</small><b>Apache</b><strong>2.4.69</strong></article>
            <article><small>DATABASE</small><b>MariaDB</b><strong>12.3.3</strong></article>
            <article><small>DATABASE UI</small><b>phpMyAdmin</b><strong>5.2.3</strong></article>
            <article class="php-stack-card"><small>LANGUAGE RUNTIMES</small><b>PHP</b><strong>8.2.35 / 8.3.36<br>8.4.27 / 8.5.12</strong><span>All four include the upstream fixes for CVE-2026-109618 and CVE-2026-109619.</span></article>
        </div>
    </section>

    <section id="security" class="section-shell security-section">
        <div class="security-spotlight">
            <div class="security-copy">
                <span class="eyebrow"><i></i> SECURITY-FIRST PHP RUNTIME</span>
                <div class="security-kicker"><span>PATCHED</span><small>WeebX <?= e($version) ?></small></div>
                <h2>Do not build on<br><em>yesterday's PHP.</em></h2>
                <p>WeebX bundles the first PHP releases carrying the upstream fixes for two critical remote-code-execution vulnerabilities. Pick the branch your project needs without falling back to an older, unpatched build.</p>
                <div class="security-actions">
                    <a class="button primary" href="#download">Get the patched stack <span>&darr;</span></a>
                    <a class="security-source" href="https://www.php.net/archive/2026.php#2026-10-21-5" target="_blank" rel="noopener noreferrer">Read the official PHP advisory <span>&nearr;</span></a>
                </div>
            </div>
            <div class="php-version-panel" aria-label="PHP versions included with WeebX">
                <div class="version-panel-head"><span>INCLUDED PHP BUILDS</span><b>Windows x64 NTS</b></div>
                <div class="php-version-grid">
                    <article><small>PHP 8.2</small><strong>8.2.35</strong><span><i></i> Patched</span></article>
                    <article><small>PHP 8.3</small><strong>8.3.36</strong><span><i></i> Patched</span></article>
                    <article><small>PHP 8.4</small><strong>8.4.27</strong><span><i></i> Patched</span></article>
                    <article><small>PHP 8.5</small><strong>8.5.12</strong><span><i></i> Patched</span></article>
                </div>
                <div class="cve-row">
                    <a href="https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w" target="_blank" rel="noopener noreferrer"><small>FIX INCLUDED</small><b>CVE-2026-109618</b><span>RCE via OOM corruption &nearr;</span></a>
                    <a href="https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp" target="_blank" rel="noopener noreferrer"><small>FIX INCLUDED</small><b>CVE-2026-109619</b><span>RCE via stale global state &nearr;</span></a>
                </div>
            </div>
        </div>
        <aside class="php-risk-note">
            <div class="risk-icon" aria-hidden="true">!</div>
            <div><span>THE RISK OF OLD PHP</span><h3>An outdated web server can become an attack path.</h3><p>Unpatched affected PHP workers serving web requests may allow an unauthenticated attacker to execute code, access data available to that worker, or cause denial of service. PHP identifies Apache <code>mod_php</code> as the highest-risk setup. PHP 8.1 and older are no longer supported upstream; a vendor may provide backports, but moving to a supported patched branch is the safer default.</p></div>
            <a href="#download">Upgrade with WeebX <span>&rarr;</span></a>
        </aside>
        <p class="security-footnote">WeebX starts in Development, lets the user choose an empty or non-empty MariaDB password, and makes the risk visible with environment-aware warnings. Before public hosting, switch to Live / Production and resolve every password warning. MariaDB stays on loopback, phpMyAdmin and diagnostics remain local-only, directory listings are disabled, and PHP session upload progress is disabled following the latest upstream guidance. Public hosting still requires trusted TLS, firewall policy, application hardening, backups, monitoring, and prompt updates.</p>
    </section>

    <section id="download" class="section-shell download-section">
        <div class="section-heading"><span>GET WEEBX <?= e($version) ?></span><h2>Choose how you want to run it.</h2><p>Every download requires acceptance of the Terms of Use and Privacy Policy.</p><div class="community-count"><strong data-download-count><?= number_format($uniqueDownloads) ?></strong><span>anonymous browser<?= $uniqueDownloads === 1 ? '' : 's' ?> downloaded WeebX</span></div></div>
        <div class="download-grid">
            <article class="download-card recommended">
                <span class="recommendation">RECOMMENDED</span><div class="package-icon">▣</div><small>WINDOWS INSTALLER</small><h3>MSI package</h3><p>A standard per-user Windows installation with Start menu and desktop shortcuts.</p>
                <?php if ($msi): ?><div class="file-meta"><span><?= e($msi['size']) ?></span><span>Updated <?= e($msi['mtime']) ?></span><span><b data-file-download-count="<?= e($msi['name']) ?>"><?= number_format((int) ($downloadStats['files'][$msi['name']]['downloads'] ?? 0)) ?></b> downloads</span></div><a class="button primary download-trigger" href="<?= e($msi['href']) ?>" data-file="<?= e($msi['name']) ?>">Download MSI <span>↓</span></a><?php else: ?><span class="button disabled">MSI not uploaded yet</span><?php endif; ?>
            </article>
            <article class="download-card">
                <div class="package-icon">◇</div><small>PORTABLE ARCHIVE</small><h3>ZIP package</h3><p>Unpack to a folder and run without a normal installer. Ideal for portable environments.</p>
                <?php if ($zip): ?><div class="file-meta"><span><?= e($zip['size']) ?></span><span>Updated <?= e($zip['mtime']) ?></span><span><b data-file-download-count="<?= e($zip['name']) ?>"><?= number_format((int) ($downloadStats['files'][$zip['name']]['downloads'] ?? 0)) ?></b> downloads</span></div><a class="button download-trigger" href="<?= e($zip['href']) ?>" data-file="<?= e($zip['name']) ?>">Download ZIP <span>↓</span></a><?php else: ?><span class="button disabled">ZIP not uploaded yet</span><?php endif; ?>
            </article>
        </div>
        <p class="download-note">Before installing or updating, back up important projects and databases. WeebX is provided without warranty.</p>
    </section>

    <section id="legal" class="section-shell legal-section">
        <div class="section-heading"><span>POLICIES &amp; TERMS</span><h2>Clear terms, in plain language.</h2><p>Effective October 25, 2026. Please review these terms before downloading or using WeebX.</p></div>
        <div class="legal-list">
            <details id="terms" open><summary><span>01</span><div><b>Terms of Use</b><small>License, responsibility, warranties, and limitations</small></div><i>+</i></summary><div class="legal-copy"><p>By downloading, installing, or using WeebX, you agree to these terms. If you do not agree, do not download or use the software.</p><p>WeebX source code is offered under the MIT License. You may use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies subject to that license and its copyright notice. Components bundled with or downloaded by WeebX remain subject to their own licenses.</p><p>You are responsible for your projects, databases, passwords, backups, firewall rules, port exposure, hosts-file changes, and compliance with laws that apply to your use. Do not use WeebX to host or distribute unlawful, harmful, infringing, or unauthorized material, or to interfere with systems you do not own or have permission to test.</p><p>The software is provided “as is,” without warranties of any kind. To the maximum extent permitted by law, the authors and contributors are not liable for data loss, downtime, lost profits, security incidents, or other damages arising from use or inability to use WeebX. Some jurisdictions do not allow every exclusion, so those limits apply only as far as legally permitted.</p></div></details>
            <details id="privacy"><summary><span>02</span><div><b>Privacy Policy</b><small>Website logs, local data, and network requests</small></div><i>+</i></summary><div class="legal-copy"><p>This website does not include account registration, advertising trackers, analytics scripts, or marketing cookies. The download-consent choice is handled in your browser and is not submitted to us by this page.</p><p>When a download begins, WeebX sets one strictly necessary, HTTP-only identifier cookie for up to one year. The server stores only a one-way hash of that random identifier so repeat downloads from the same browser do not inflate the public “people downloaded” count. The counter does not use the identifier to track browsing activity, and it does not store an IP address in its counter data. Clearing cookies or using another browser or device may create another anonymous count.</p><p>Like most hosted websites, the web server or hosting provider may separately process standard request data such as IP address, browser type, requested URL, referrer, timestamp, and download activity for delivery, security, and operational logging. Retention and access may also be governed by the hosting provider.</p><p>WeebX is designed to keep project files, configuration, credentials, and database content on your Windows device. It does not intentionally upload that content to JadaDev. When you request a component install or open an external documentation link, your device may connect to the relevant third-party provider, whose privacy terms then apply.</p><p>Do not place sensitive data in a publicly reachable document root. Protect database credentials, review enabled modules, and restrict network access according to your environment.</p></div></details>
            <details id="download-policy"><summary><span>03</span><div><b>Download &amp; Update Policy</b><small>Backups, compatibility, and release files</small></div><i>+</i></summary><div class="legal-copy"><p>Release files are provided for supported 64-bit Windows environments. Compatibility can vary with Windows updates, security software, occupied ports, permissions, and third-party runtime changes.</p><p>Normal WeebX updates are designed to preserve websites and MariaDB data, but no update process can replace a verified backup. Back up important data before installing, updating, relocating, repairing, or uninstalling a runtime. Download files only from the official WeebX site or repository.</p><p>Versions, included components, release availability, and support may change. Preview runtimes may be less stable and should not be used for critical work.</p></div></details>
            <details id="third-party"><summary><span>04</span><div><b>Third-Party Software &amp; Trademarks</b><small>Independent projects and licenses</small></div><i>+</i></summary><div class="legal-copy"><p>Apache HTTP Server, PHP, MariaDB, phpMyAdmin, Windows, XAMPP, and other named products belong to their respective owners and are governed by their respective licenses and policies. Their inclusion or mention does not imply endorsement.</p><p>WeebX is an independent hosting stack manager and is not affiliated with, sponsored by, or endorsed by Apache Friends or the XAMPP project. “XAMPP” is used only to describe product category and compatibility expectations.</p></div></details>
        </div>
    </section>
</main>

<footer>
    <div class="footer-main section-shell"><div class="footer-brand"><img src="assets/weebx-logo.png" alt=""><div><strong>WeebX</strong><p>A local web hosting stack manager for Windows.</p></div></div><div class="footer-links"><div><b>Product</b><a href="#features">Features</a><a href="#stack">Included stack</a><a href="#security">PHP security</a><a href="#download">Downloads</a></div><div><b>Legal</b><a href="#terms">Terms of Use</a><a href="#privacy">Privacy Policy</a><a href="#download-policy">Download Policy</a></div><div><b>Community</b><a href="https://github.com/JadaDev/WeebX" rel="noopener noreferrer">GitHub</a><a href="https://github.com/JadaDev/WeebX/issues" rel="noopener noreferrer">Report an issue</a><a href="https://github.com/JadaDev/WeebX/blob/main/LICENSE" rel="noopener noreferrer">MIT License</a></div></div></div>
    <div class="footer-bottom section-shell"><span>© <?= date('Y') ?> JadaDev. WeebX <?= e($version) ?>.</span><small>WeebX is an independent XAMPP alternative for Windows and is not affiliated with Apache Friends or the XAMPP project.</small></div>
</footer>

<dialog class="consent-dialog" id="download-consent" aria-labelledby="consent-title">
    <div class="consent-head"><div class="consent-logo"><img src="assets/weebx-logo.png" alt=""></div><div><span>ONE LAST STEP</span><h2 id="consent-title">Review before downloading</h2></div><button type="button" class="dialog-close" aria-label="Close download dialog">×</button></div>
    <p class="consent-intro">You are about to download <strong id="consent-file">WeebX</strong>. Please confirm that you understand the usage terms.</p>
    <div class="consent-summary"><div><b>Hosting and development software</b><span>Back up important projects and databases before making runtime changes.</span></div><div><b>Provided without warranty</b><span>You are responsible for configuration, credentials, security, and lawful use.</span></div></div>
    <label class="consent-check"><input type="checkbox" id="accept-terms"><span><i>✓</i></span><b>I have read and agree to the <a href="#terms" data-close-consent>Terms of Use</a>.</b></label>
    <label class="consent-check"><input type="checkbox" id="accept-privacy"><span><i>✓</i></span><b>I have read and acknowledge the <a href="#privacy" data-close-consent>Privacy Policy</a>.</b></label>
    <div class="consent-actions"><button type="button" class="button ghost dialog-cancel">Cancel</button><button type="button" class="button primary consent-download" disabled>Agree &amp; download <span>↓</span></button></div>
    <small class="consent-note">Your acceptance is used only to continue this download and is not sent by this page.</small>
</dialog>
</body>
</html>
