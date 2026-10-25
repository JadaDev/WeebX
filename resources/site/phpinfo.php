<?php
declare(strict_types=1);
// WEEBX_PHPINFO_PAGE

$version = htmlspecialchars(PHP_VERSION, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
ob_start();
phpinfo();
$html = (string) ob_get_clean();

$css = <<<CSS
<link rel="icon" href="assets/weebx-logo.png">
<link rel="stylesheet" href="assets/weebx.css">
<style>
  body { margin: 0; background: #080c17; color: #eef1ff; }
  h1.p, h2.p, td, th, a { font-family: "Segoe UI", sans-serif !important; }
  table { border-color: #25304a !important; }
  td.e { background: #151c2d !important; color: #c4bbff !important; }
  td.v, td.h { background: #101827 !important; color: #eef1ff !important; }
  h1, h2 { color: #eef1ff !important; }
</style>
CSS;

$banner = <<<HTML
<div class="phpinfo-bar">
  <img src="assets/weebx-logo.png" alt="WeebX">
  <div><strong>PHP information</strong><span>Served by WeebX · {$version}</span></div>
  <a class="btn" href="./">Back to WeebX</a>
</div>
HTML;

$html = preg_replace('/<head>/i', '<head>' . $css, $html, 1) ?? $html;
$html = preg_replace('/<body[^>]*>/i', '$0' . $banner, $html, 1) ?? $html;
echo $html;
