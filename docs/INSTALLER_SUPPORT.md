# Automnia Installer Support Matrix

Automnia packages the same desktop app for Windows x64, Intel macOS x64, Apple silicon macOS arm64, and Linux x86_64. The release workflow builds each artifact on a native GitHub-hosted runner and runs an install or launch smoke before an artifact can be published.

| Platform | Customer installer | Architecture | Minimum OS / ABI | CI validation host |
| --- | --- | --- | --- | --- |
| Windows | NSIS `.exe` | x64 | Windows 10 x64 or later; Windows 11 x64 is the primary target | `windows-2025` x64 |
| macOS Intel | `.dmg` and updater `.zip` | x86_64 | macOS 13.5 or later | `macos-15-intel` |
| macOS Apple silicon | `.dmg` and updater `.zip` | arm64 | macOS 13.5 or later | `macos-15` Apple silicon |
| Linux | `.deb` and `.AppImage` | x86_64 | Ubuntu 22.04 is the CI-tested baseline; no distro-wide minimum is declared | `ubuntu-22.04` x64 |

The macOS floor combines Electron 45's macOS 13 requirement with the bundled Node.js 24.22.1 runtime's macOS 13.5 minimum. The macOS release smoke checks `LSMinimumSystemVersion`, verifies the binary architecture, mounts and copies the app from the DMG, extracts the updater ZIP, and launches both packaged apps.

The Linux AppImage uses electron-builder's static 1.0.3 runtime to avoid a FUSE2 requirement. The bundled Node 24 runtime supports glibc 2.28 and newer, but Electron and native modules also depend on system libraries. The normal AppImage launch path is smoke-tested, as are DEB installation, application launch, and removal. The published DEB and AppImage are x86_64 only; Linux ARM packages are not produced. The Ubuntu runner proves the release on that environment, not on every Linux distribution or desktop session.

The Windows lifecycle smoke installs and launches the app, checks the signed updater manifest and payload integrity, performs an in-place upgrade from the published installer, then verifies relaunch and uninstall. A release is not considered fully verified if any lifecycle step fails.

## Signing and customer distribution

Manual workflow runs are unsigned build candidates for CI verification and never update customer download aliases. Version-tagged customer releases ordinarily require an Authenticode-signed Windows installer and a Developer ID signed, Apple-notarized Mac app. The v1.0.28, v1.0.29, v1.0.30, and v1.0.31 exceptions permit unsigned Windows and Mac installers only when their matching repository variables `AUTOMNIA_ALLOW_UNSIGNED_V1_0_28=true`, `AUTOMNIA_ALLOW_UNSIGNED_V1_0_29=true`, `AUTOMNIA_ALLOW_UNSIGNED_V1_0_30=true`, and `AUTOMNIA_ALLOW_UNSIGNED_V1_0_31=true` are enabled for the exact tag; updater manifests remain signed. Windows and macOS users may receive SmartScreen or Gatekeeper warnings. Later releases continue to require platform signing. Linux package integrity is covered by the signed updater metadata and download hashes.

Architecture and CI smoke success do not guarantee operation on every individual machine. Customers need a supported OS version, the matching CPU architecture, and a compatible Linux desktop/system library set. Hardware-specific graphics drivers, endpoint security, and machine policies can still affect startup or installation; a new report should include the OS version and the relevant installer/runtime logs.
