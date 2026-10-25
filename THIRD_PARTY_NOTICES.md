# Third-party software

WeebX source code is licensed under the MIT License. The following projects are
separate works and remain governed by their own licenses and security policies:

- Electron and the npm packages declared in `package.json`;
- Apache HTTP Server;
- PHP;
- MariaDB;
- phpMyAdmin; and
- the Chromium and Node.js components distributed with Electron.

Their binary packages are not committed to this source repository. The
`scripts/prepare-runtime.ps1` script records the selected upstream downloads,
versions and expected SHA-256 hashes. Review each project's license before
redistributing a compiled WeebX package.

WeebX is independent software and is not affiliated with or endorsed by Apache
Friends or the XAMPP project.
