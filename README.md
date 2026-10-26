# WeebX 2.0.5

WeebX is a **Local Web Hosting Stack Manager for Windows**. It brings Apache, multiple PHP runtimes, MariaDB, phpMyAdmin, virtual hosts, configuration, permissions, logs, portability, and service recovery into one desktop control panel.

WeebX is designed for both local development and real website hosting. Development is the default environment; a hardened **Live / Production** profile is always one click away.

Website: [weebx.jadadev.com](https://weebx.jadadev.com/)  
License: MIT

## Included stack

| Component | Included version |
| --- | --- |
| Apache HTTP Server | 2.4.69 |
| PHP x64 NTS | 8.2.35, 8.3.36, 8.4.27, 8.5.12 |
| MariaDB Server | 12.3.3 |
| phpMyAdmin | 5.2.3 |

MariaDB is the community-developed, open-source fork of MySQL used by WeebX. It is compatible with the MySQL protocol and PHP drivers, but the product and user interface call the database by its accurate name: **MariaDB**.

## Installation

WeebX supports Windows 10 and Windows 11 x64.

1. Run `WeebX-Installer-x64.msi`.
2. Open WeebX and let it prepare the bundled runtime.
3. Complete first-run MariaDB setup:
   - keep the generated strong password;
   - use **Regenerate** whenever you want a different strong password;
   - enter a password of your own; or
   - explicitly choose an empty password for local development.
4. Start Apache and MariaDB from the dashboard.

The hosting runtime is installed to `C:\WeebX` by default. This keeps the familiar, predictable layout used by traditional Windows stack packages:

```text
C:\WeebX\
├─ apache\
├─ php\
│  ├─ 8.2.35\
│  ├─ 8.3.36\
│  ├─ 8.4.27\
│  └─ 8.5.12\
├─ mariadb\
│  └─ data\
├─ htdocs\
├─ certificates\
├─ logs\
└─ tmp\
```

Existing installations keep their configured runtime path. Settings can relocate or repair paths after the folder is moved.

## Environment profiles

### Development — default

- PHP errors are visible for debugging and also logged.
- PHP configuration changes are picked up immediately.
- The bundled `phpinfo()` diagnostics page is available only from the local machine.
- The welcome page exposes no credentials, environment variables, or private absolute paths.
- The dashboard reminds the operator to switch profiles before public exposure.

### Live / Production

- Displayed PHP errors and startup errors are disabled.
- Errors continue to be written to the protected PHP error log.
- `expose_php` is disabled.
- Exception arguments are hidden.
- Assertions are disabled and OPcache uses production behavior.
- Secure session settings are applied, including HTTPS-only session cookies.
- Detailed PHP diagnostics are unavailable.

## MariaDB password policy

WeebX allows flexibility during development without hiding the risk from the user.

| Password state | Development | Live / Production |
| --- | --- | --- |
| Empty | Warning | Critical warning |
| Weak | Warning | High-priority warning |
| Strong | Secure status | Secure status |

A strong password has at least 12 characters and includes uppercase, lowercase, a number, and a symbol. First-run setup and Settings can generate or regenerate a cryptographically random 24-character password. Empty and weak passwords remain allowed, but a compact dashboard notice stays visible until the password is strong. Non-empty credentials are encrypted with the current Windows account and are never written into phpMyAdmin configuration. Settings can reveal the saved password after an explicit local confirmation; it is decrypted only on demand, automatically hidden after 30 seconds or when WeebX loses focus, and is not included in normal dashboard snapshots.

MariaDB listens on `127.0.0.1` by default, `LOCAL INFILE` is disabled, anonymous accounts and the test database are removed during setup, and the root account is limited to local host identities. phpMyAdmin uses cookie authentication and is restricted to local requests. Passwordless phpMyAdmin login is enabled only when the operator explicitly chose an empty MariaDB password.

## Features

### Dashboard and service control

- Start, stop, or restart Apache and MariaDB independently.
- Start or stop the complete stack with one action.
- See service state, PID, port, uptime, and crash-recovery configuration.
- Inspect port ownership and recent activity.
- Open `htdocs`, the active website, or local-only phpMyAdmin.
- Use the live service nucleus: quiet with no orbit at 0, one multi-node glowing path at 1, and two independently animated paths with smooth, staggered service particles when both services are running. Reduced-motion preferences are respected.
- Receive environment-aware password and Development-mode security notices.
- Keep the Development security notice icon and message vertically aligned at every window size.
- Refresh Apache security defaults without losing the configured `DocumentRoot`, `.htaccess` support, or the explicit website access grant.
- Finish first-run runtime preparation reliably even when Windows security software temporarily locks a new file; WeebX retries recoverable writes until they succeed or the operator cancels.
- Repair runtime access automatically if an older permission pass left files unreadable, while showing the active recovery step instead of leaving preparation at `0 / 0`.

### PHP version management

- Switch instantly among installed PHP versions; Apache restarts automatically when needed.
- Keep a separate `php.ini` and extension set for every version.
- Search and toggle PHP extensions and Apache modules.
- Tune memory, uploads, post size, execution time, input time, file count, and input variables.
- Discover current releases from PHP's official Windows release metadata.
- Automatically select the correct Windows **x64 NTS** build used by WeebX's CGI integration.
- Verify every automatic PHP download against PHP's published SHA-256 checksum before extraction.
- Import a manual PHP ZIP through the Advanced flow. WeebX rejects path traversal and excessive expanded contents, then validates PHP 8.2+, 64-bit architecture, Non-Thread-Safe mode, `php-cgi.exe`, and the extension folder before installation.
- Only enable managed extensions whose DLLs exist in the selected build.

For a manual import, download the x64 **Non Thread Safe (NTS)** ZIP from the official Windows PHP page. Do not choose the source, debug, development, x86, or Thread Safe package. Keep the file zipped, select it in **PHP versions → Add PHP version → Manual / advanced**, then activate it after validation. Manual validation executes the selected `php.exe`, so never import an archive you do not trust.

### Virtual hosts

- Create a project folder and hostname from one form.
- Add aliases, HTTP, and optional HTTPS.
- Generate self-signed development certificates.
- Add local Windows hosts-file mappings when WeebX is elevated.
- Enable or disable a host without deleting its files.
- Preserve custom configuration outside WeebX-managed markers.

Self-signed certificates are for local testing. Public websites require a certificate trusted by browsers.

### Windows file permissions

Settings provides guided NTFS presets for `htdocs`, MariaDB data, or the complete runtime:

- **Private:** current Windows user, SYSTEM, and administrators only. Recommended for database data and live sites.
- **Owner writable:** inherits Windows permissions and grants the current owner Modify access. Convenient during development.
- **Windows defaults:** resets the selected tree to inherited Windows ACLs.

WeebX briefly stops affected services, applies the selected permissions with the native Windows ACL system, and restarts the services. Private permissions are applied to the root and safely inherited by every descendant, keeping files readable by the owner instead of creating inherit-only file entries. Advanced users can open the target folder and use Windows Security properties for a dedicated service account or custom group policy.

NTFS permissions protect files from other Windows accounts; they do not sandbox unsafe PHP code running as the same account. Applications must still validate uploads, keep secrets outside public folders, and follow their framework's production guidance.

### Configuration, logs, and recovery

- Edit `php.ini`, `httpd.conf`, `httpd-vhosts.conf`, and `my.ini`.
- Validate Apache, PHP, and MariaDB configuration before relying on it.
- Review categorized Apache, MariaDB, and system logs.
- Preserve MariaDB's own Note, Warning, and Error severity instead of treating every stderr line containing words such as `failed` as an error.
- Configure independent Apache and MariaDB crash recovery with selectable delays.
- Detect occupied HTTP, HTTPS, and MariaDB ports.
- Start WeebX with Windows and optionally start the stack when the panel opens.

### Portability and data safety

- Pack Apache, PHP, configuration, virtual hosts, websites, and optional MariaDB data into a WeebX Portal.
- Unpack a Portal on another disk or machine and rebase its paths.
- Repair paths after moving an installation.
- Preserve websites during uninstall by copying them to `Documents\WeebX Sites`.
- Preserve websites and MariaDB data during normal component updates.
- Never export the saved MariaDB credential in a Portal; the destination returns to first-run setup.

## Security defaults

- The Electron renderer uses sandboxing, context isolation, no Node.js integration, a restrictive Content Security Policy, denied permission requests, and a narrow IPC bridge.
- Component downloads use HTTPS allowlists, validate redirects, enforce size limits, and require SHA-256 checksums.
- Apache denies filesystem access by default, disables directory indexes and TRACE, blocks dotfiles and common secret/config/backup extensions, limits request timeouts, and reduces version disclosure.
- MariaDB and phpMyAdmin remain loopback-only by default.
- MariaDB's optional feedback plugin is explicitly disabled.
- phpMyAdmin uses cookie authentication with no stored database password and a short login-cookie lifetime.
- PHP diagnostics are local-only and redact private paths; environment variables are never printed.
- Session upload progress is disabled in both profiles, following PHP's current defense-in-depth guidance for the bundled October 2026 security releases.
- The bundled public welcome page contains no credentials, database errors, private paths, or detailed server versions in Live / Production.
- New runtime files receive the Private NTFS preset automatically when Windows permits it.

These controls provide a hardened platform baseline; they cannot make arbitrary website code fully secure.

## Before hosting a public website

1. Switch PHP to **Live / Production**.
2. Resolve every password warning and create a separate least-privilege MariaDB user for each site. Do not use `root` in application code.
3. Install a trusted TLS certificate and redirect public HTTP traffic to HTTPS.
4. Allow only required inbound ports in Windows Firewall and the provider firewall. Never expose MariaDB port 3306 publicly.
5. Keep phpMyAdmin local-only; use the server console, a VPN, or an SSH tunnel for administration.
6. Patch Windows, WeebX, Apache, PHP, MariaDB, phpMyAdmin, frameworks, plugins, and application dependencies promptly.
7. Store secrets outside `htdocs`, restrict uploads, disable script execution in upload folders, and validate every uploaded file.
8. Maintain tested, encrypted, off-machine backups of websites, databases, certificates, and configuration.
9. Add monitoring, log rotation, rate limiting, and a reverse proxy or edge security service appropriate to the expected traffic.
10. Run the public host under a dedicated non-administrator Windows account where practical.

## Build from source

Requirements: Node.js 22+ and Windows x64.

```powershell
npm install
npm run typecheck
npm test
npm run build
```

Prepare the offline stack and build the installer:

```powershell
npm run prepare:runtime
npm run dist:msi
```

Release artifacts are assembled in `release\WeebX`. Third-party packages come from the official PHP for Windows, Apache Lounge, MariaDB, and phpMyAdmin distribution channels and are verified with pinned SHA-256 hashes.

The locally assembled 2.0.5 executable and MSI are not Authenticode-signed. Before distributing WeebX as a trusted public download, configure a Windows code-signing certificate in the release pipeline, sign the application and installer, timestamp the signatures, and verify them on a clean Windows machine.

The public website is in `website\WeebX`. Release files belong in `website\WeebX\Files`; direct access to that directory is denied and downloads pass through the validated endpoint.

## License and responsibility

WeebX is released under the MIT License. Apache, PHP, MariaDB, phpMyAdmin, Windows, XAMPP, and other names belong to their respective owners and follow their own licenses. WeebX is independent from Apache Friends and the XAMPP project.

The operator remains responsible for DNS, trusted TLS, firewall rules, operating-system security, application vulnerabilities, backups, monitoring, abuse prevention, privacy, and incident response.
