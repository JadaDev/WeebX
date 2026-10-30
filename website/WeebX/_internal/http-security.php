<?php
declare(strict_types=1);

function isSecureRequest(): bool
{
    $https = $_SERVER['HTTPS'] ?? '';
    return (is_string($https) && $https !== '' && strtolower($https) !== 'off')
        || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443;
}

function enforceReadOnlyRequestMethod(): string
{
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        header('Allow: GET, HEAD');
        http_response_code(405);
        exit('Method not allowed.');
    }
    return $method;
}

function sendBrowserSecurityHeaders(string $contentSecurityPolicy, string $referrerPolicy = 'no-referrer'): void
{
    header_remove('X-Powered-By');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('X-Permitted-Cross-Domain-Policies: none');
    header('Referrer-Policy: ' . $referrerPolicy);
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Origin-Agent-Cluster: ?1');
    header('Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=()');
    header('Content-Security-Policy: ' . $contentSecurityPolicy);
    if (isSecureRequest()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}
