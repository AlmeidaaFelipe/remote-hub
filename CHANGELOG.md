# Change Log

All notable changes to the "Remote Hub" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.9] - 2026-10-02

### Fixed

- Updated both development and marketplace READMEs to describe current save behavior, recursive uploads, session isolation, and SSH host-key trust.
- Replaced the retired VS Code Marketplace install badge and synchronized both README version badges with the packaged release.
- Added prepackaging checks for the PNG marketplace icon and Activity Bar icon so missing assets block packaging and publication.
- Updated local development and publishing documentation to match the current commands and validation coverage.

## [1.0.8] - 2026-10-02

### Added

- Regression suite with 32 tests, including a real SSH/SFTP localhost connection, binary transfers, and command execution.
- Session-bound remote documents, caches, diff resources, queued operations, and file watcher events.
- Complete filesystem operations for remote stat, directory listing/creation, binary writing, rename, and deletion, with create/overwrite/recursive checks and change events.
- Recursive drag-and-drop uploads preserving nested and empty local folders, with cancellation and symbolic-link rejection.
- Explicit SSH host-key trust on first use, changed-key rejection, and a command to forget a verified host key.
- Real FTP/FTPS integration tests, Chromium webview tests in both languages, and an isolated Extension Host suite including native saves.
- ESLint configuration, typecheck/check/editor test scripts, and GitHub Actions validation on Windows/Linux and Node.js 22/24.
- `npm test` command to compile and run the regression, transport, and webview suites.
- Updated README documenting architecture, validation coverage, and known limitations.

### Changed

- `npm run compile` now generates the installable VSIX; `npm run build` compiles TypeScript for development, tests, and the packaging hook.
- Marketplace publishing scripts load tokens from `tools/.env` or environment variables and validate credentials before building; local credentials are excluded from Git and the VSIX.
- Synchronized package and lockfile versions at 1.0.8; the lockfile previously reported 0.0.1.
- Ignored local documentation, diagnostics, coverage output, incremental compiler metadata, and environment files in Git.
- Updated `basic-ftp` to 6.2.1, resolving the audited production vulnerabilities.
- Native filesystem saves upload editor-provided bytes immediately and skip duplicate fallback uploads; save failures propagate to the editor.
- Separated saved connection persistence, connection contracts, operation serialization, save timers, and remote shell command construction into focused modules.
- Consolidated explorer selection and directory mapping, and reused the original-content update path for diff baselines.
- Registered connection managers, providers, watcher resources, status subscriptions, webview listeners, emitters, and save timers for disposal by the Extension Host.
- Excluded tests, technical documentation, and the historical error log from VSIX packages.

### Fixed

- Prevented documents, pending file events, queued operations, and interrupted connection attempts from following a later server connection.
- Kept FTP working-directory state stable after directory creation.
- Applied command-specific exit-code handling: grep accepts no-match exit code 1; archive failures and stream errors are surfaced.
- Replaced Windows shell launching in the editor test runner so project paths containing spaces are passed intact.
- Unreadable SSH private keys now reject connection attempts instead of producing an unhandled rejection and leaving the connection pending.
- Search, compression, and extraction now escape paths and names containing apostrophes. Search and compression separate operands from options; ZIP extraction prefixes the archive name with `./`.

## [1.0.7] - 2026-05-22

### Fixed

- Fixed path resolution issue in Antigravity IDE caused by the `main` field pointing to `./out/extension.js`.

## [1.0.5] - 2026-04-02

### Added

- **Remote Compress/Extract (SSH/SFTP)**: Right-click any file or folder in the Remote Explorer to compress it into a `.tar.gz` archive directly on the server. Right-click a `.tar.gz`, `.tgz`, `.zip`, or `.gz` file to extract it in place — all without downloading anything.
- **File Watcher (Local → Remote Sync)**: Click the eye icon (👁) in the Explorer title bar to select a local folder. Any file created, modified, or deleted in that folder will be automatically synced to the remote server in real-time. Includes a warning dialog before activation and auto-stop on disconnect.

## [1.0.4] - 2026-03-31

### Added

- **Inline Diff (Automatic)**: Remote files now show automatic inline diff decorations in the editor gutter — green for added lines, red for removed, blue for modified — just like Git. Powered by VS Code's native QuickDiffProvider.
- **Compare with Remote**: Right-click any remote file in the Explorer and select "Compare with Remote" to open a side-by-side diff view comparing the server version with your local edits.
- **Drag & Drop Upload/Move**: You can now drag and drop files from your computer directly into the Remote Hub explorer to upload them, or drag files within the remote tree to move them. Includes native VS Code progress notifications during upload.
- **Remote Search (SSH/SFTP)**: Added a "Search Remote" button. Easily find text across your remote server files instantly using native server commands without downloading the files first. Click a result to jump directly to that line.

### Fixed

- **File Deletion Bug on SSH**: Fixed an issue where deleting files while connected via pure SSH would fail with a `this._client.remove is not a function` error.

## [1.0.3] - 2026-03-29

### Added

- **Secure Password Storage**: Passwords can now be saved using VS Code's SecretStorage API (OS-level encrypted keychain). A new "Save password (encrypted)" checkbox appears in the connection form.
- Saved connections with stored passwords now auto-detect on load and allow one-click reconnect without re-entering credentials.
- **File Icon Theme Support**: The remote Explorer now uses your active file icon theme (e.g., Material Icon Theme, vscode-icons) to display icons per file extension.
- **Progress Notifications**: File downloads and uploads now display native VS Code progress notifications instead of status bar messages.
- **SSH Config Support**: The extension now resolves SSH aliases natively via `~/.ssh/config`. If you type a known Host alias into the Host field, the connection automatically picks up the defined HostName, User, Port, and IdentityFile.

### Changed

- Removed in-memory password cache in favor of SecretStorage.
- Deleting a saved connection now also removes its stored password from the keychain.
- Connection root node now uses a "remote" icon for better visual distinction.

## [1.0.2] - 2026-03-27

### Fixed

- Fixed duplicate log messages in the connection panel.

### Added

- Passphrase support for encrypted SSH private keys.
- Windows SSH Agent support via OpenSSH named pipe.

## [1.0.1] - 2026-03-27

### Changed

- Updated README.md with Open VSX, VS Code Marketplace, and GitHub links.
- Added multi-language support (English and Portuguese).
- Added repository and license metadata.

## [1.0.0] - 2026-03-25

### Added

- Initial release of Remote Hub extension.
- Support for SSH, SFTP, FTP, and FTPS connections.
- Explorer view for browsing remote files and folders.
- Context menu actions: New File, New Folder, Rename, Delete, Copy Path.
- Auto-upload functionality on save.
- Password, Private Key, and SSH Agent authentication.
