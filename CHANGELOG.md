# Change Log

All notable changes to the "Remote Hub" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Initial development and testing.

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
