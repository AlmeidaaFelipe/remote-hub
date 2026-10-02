# Remote Hub

[Remote Hub](https://almeidafelipe.com) provides remote file management and editing for **VS Code** and **Google Antigravity**. Connect via SSH, SFTP, FTP, or FTPS to browse remote files in a native Explorer-like tree, and edit them with auto-upload on save.

<p align="center">
  <em>
    SSH
    · SFTP
    · FTP
    · FTPS
  </em>
  <br />
  <em>
    Explorer Tree
    · Auto-upload
    · File Operations
  </em>
  <br />
  <em>
    <a href="https://almeidafelipe.com">
      By Felipe Almeida
    </a>
  </em>
</p>

<p align="center">
  <a href="https://open-vsx.org/extension/AlmeidaaFelipe/remote-hub">
    <img alt="Open VSX Downloads" src="https://img.shields.io/open-vsx/dt/AlmeidaaFelipe/remote-hub?label=Open%20VSX%20Downloads"></a>
  <a href="https://open-vsx.org/extension/AlmeidaaFelipe/remote-hub">
    <img alt="Open VSX Version" src="https://img.shields.io/badge/Open%20VSX-v1.0.9-blue"></a>
  <br />
  <a href="https://marketplace.visualstudio.com/items?itemName=AlmeidaaFelipe.remote-hub">
    <img alt="VS Code Marketplace Installs" src="https://badgen.net/vs-marketplace/i/AlmeidaaFelipe.remote-hub?label=VS%20Code%20Installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=AlmeidaaFelipe.remote-hub">
    <img alt="VS Code Marketplace Version" src="https://img.shields.io/badge/VS%20Code-v1.0.9-blue"></a>
  <br />
  <a href="https://github.com/AlmeidaaFelipe/remote-hub">
    <img alt="GitHub" src="https://img.shields.io/badge/GitHub-Repository-181717?logo=github"></a>
</p>

## Installation

### Open VSX (Google Antigravity & VS Codium)

Install through the Extensions panel. Search for `Remote Hub`

[Open VSX Registry: Remote Hub](https://open-vsx.org/extension/AlmeidaaFelipe/remote-hub)

### VS Code Marketplace

Install through the Extensions panel. Search for `Remote Hub`

[VS Code Marketplace: Remote Hub](https://marketplace.visualstudio.com/items?itemName=AlmeidaaFelipe.remote-hub)

### Manual Install (.vsix)

1. Download the latest `.vsix` from [Releases](https://github.com/AlmeidaaFelipe/remote-hub/releases).
2. Open the Extensions panel (`Ctrl+Shift+X`).
3. Click `...` → **Install from VSIX...** and select the file.

### Install via command

In any compatible editor, launch Quick Open (`Ctrl+P`) and run:

```
ext install AlmeidaaFelipe.remote-hub
```

### Local Development

Use Node.js 22.13 or later for development and tests. To install the locked dependencies and build locally:

```bash
npm ci
npx playwright install chromium
npm run build
```

Press `F5` in your editor to start an Extension Development Host. Run `npm test` before submitting changes.

## Quick Start

1. Open **Remote Hub** from the Activity Bar.
2. Create a new connection (`Label`, host, auth, remote path).
3. Click **Connect**.
4. Browse files in **Explorer**.
5. Open any remote file and edit normally.
6. Save and Remote Hub uploads the file automatically.

## Supported Protocols

This extension supports various remote protocols depending on your needs. The following are currently supported:

```
ssh
sftp
ftp
ftps
```

## Authentication

Remote Hub supports multiple authentication methods:

- **Password**: Optionally saved via VS Code's SecretStorage API (OS-level encrypted keychain). When "Save password" is checked, your credentials are stored securely between sessions. Otherwise, the password is only kept in memory for the current session.
- **Private Key Path**: Connect using a secure private key file. Supports encrypted keys with passphrase prompt.
- **SSH Agent**: Authentication for SSH/SFTP protocols using the system agent. Works on Linux, macOS, and Windows (OpenSSH).

On the first SSH/SFTP connection to a host and port, Remote Hub shows a SHA-256 host-key fingerprint and asks for explicit trust. Verify the fingerprint with the server administrator. Matching keys are remembered in extension storage; changed keys block the connection. After verifying a legitimate server-key change, run **Remote Hub: Forget SSH Host Key** from the Command Palette and reconnect. This trust registry is separate from the system `known_hosts` file.

## Usage

### Connection Behavior

- Switching to a different server disconnects the current one first. Documents, queued operations, watcher events, caches, and diff baselines are bound to a session. Old documents cannot upload to the new connection; reopen them from the current explorer.
- Up to ten saved connections are stored in `globalState` without passwords. Passwords are stored separately in SecretStorage when requested.
- Remote operations run sequentially. Recognized connection-loss errors trigger one reconnect attempt and one retry.

### Explorer Actions

The custom `Explorer` view provides comprehensive file manipulation capabilities.
Root connection row (`Label`) includes inline actions:

- New File
- New Folder

Right-click context menu on tree items includes:

- New File
- New Folder
- Copy Path
- Rename
- Delete

### File Icons

Remote Hub respects your active file icon theme. If you have an icon theme installed (e.g., **Material Icon Theme**, **vscode-icons**), the remote Explorer will display the correct icons for each file type automatically.

### Inline Diff (Automatic)

When you edit a remote file, Remote Hub automatically tracks changes against the original server version. The editor gutter shows colored markers:

- 🟢 **Green bar** — new lines added
- 🔴 **Red arrow** — lines deleted
- 🔵 **Blue bar** — lines modified

Click any gutter marker to see the inline diff popup showing the original vs. current content — identical to how Git works in VS Code.

You can also right-click any file in the Remote Explorer and select **"Compare with Remote"** to open a full side-by-side diff view.

After a successful upload, the diff baseline resets automatically.

### Remote Search

Quickly find text across your remote server files without downloading them first!

Click the **Search** icon (🔍) in the Remote Explorer title bar, or right-click any folder and select **"Search Remote"**. Enter your search term, and Remote Hub will execute a fast native search (`grep`) over SSH and display the results in a drop-down menu. Click any result to instantly jump to that line in the remote file.
*(Note: This feature requires an SSH or SFTP connection).*

### Drag & Drop

You can drag and drop files from your computer (e.g., Windows Explorer) directly into the Remote Hub explorer to upload them instantly. A native VS Code progress notification will keep you updated during the upload. You can also drop local folders to upload their contents recursively, including empty directories. Existing files at the destination are overwritten. Transfers run sequentially and can be cancelled between entries. Symbolic links are rejected. Drag files *within* the remote tree to move them between folders; moving a folder into itself or one of its descendants is prevented.

### Remote Compress / Extract

Right-click any file or folder in the Remote Explorer and select **"Compress Here"** to create a `.tar.gz` archive directly on the server — no need to download anything first.

To extract, right-click a `.tar.gz`, `.tgz`, `.zip`, or `.gz` file and select **"Extract Here"**. The contents will be extracted in the same directory on the server.
*(Note: This feature requires an SSH or SFTP connection. For `.zip` files, `unzip` must be available on the server).*

### Auto Upload

Remote Hub listens to editor save events and uploads edited remote files automatically.

**Flow:**

1. Open remote file (`sftp://...`)
2. Edit in editor
3. Save (`Ctrl+S` or Auto Save)
4. The filesystem provider uploads the bytes supplied by the editor and shows a progress notification
5. Status bar confirms completion; failed uploads fail the save and retain the previous diff baseline

The save listener retains a 700 ms fallback debounce for callers that bypass the filesystem write path. A filesystem-confirmed save skips the fallback upload, avoiding duplicate transfers.

### File Watcher (Local → Remote Sync)

Click the **eye icon** (👁) in the Remote Explorer title bar to start monitoring a local folder. File events inside that folder are synced to the remote server after a 500 ms debounce per path. Starting the watcher does not upload the existing folder contents.

- A status bar item shows which folder is being watched
- Click the eye icon again (or the status bar) to stop watching
- The watcher automatically stops when you disconnect
- A warning dialog is shown before activation, since deletions are also synced
- No ignore filters are currently applied; choose the monitored folder carefully

## Internationalization

Remote Hub automatically adapts to your editor's language. Currently supported:

- 🇺🇸 English (default)
- 🇧🇷 Português (Brasil)

## Development

The extension uses TypeScript in strict mode and compiles to CommonJS in `out/`. It maintains one active remote connection.

```text
remote-hub/
├── src/
│   ├── media/
│   ├── extension.ts
│   ├── ConnectionTypes.ts
│   ├── ConnectionManager.ts
│   ├── ConnectionStore.ts
│   ├── SerialQueue.ts
│   ├── AutoUploadController.ts
│   ├── HostKeyVerifier.ts
│   ├── LocalUploader.ts
│   ├── RemoteUri.ts
│   ├── RemoteCommands.ts
│   ├── RemoteExplorerProvider.ts
│   ├── RemoteFileSystemProvider.ts
│   ├── DiffProvider.ts
│   ├── FileWatcher.ts
│   ├── SftpPanelViewProvider.ts
│   ├── SshConfigParser.ts
│   └── i18n.ts
├── tests/
│   ├── regression.test.cjs
│   ├── ftp.test.cjs
│   ├── webview.test.cjs
│   ├── run-editor.cjs
│   ├── editor/
│   └── helpers/
├── .github/workflows/ci.yml
├── eslint.config.cjs
├── package.nls.json
├── package.nls.pt-br.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── CHANGELOG.md
└── README.md
```

`ConnectionManager` coordinates transport and reconnects. `ConnectionStore` owns persistence; `SerialQueue` orders remote operations; `AutoUploadController` owns save timers; `RemoteCommands` builds escaped shell commands. `HostKeyVerifier` owns SSH trust; `LocalUploader` walks local folders; `RemoteUri` preserves session identity in remote resource URIs. Providers integrate the explorer, documents, diffs, and connection panel with the editor.

| Command | Purpose |
|---------|---------|
| `npm ci` | Install the dependencies recorded in the lockfile |
| `npm run build` | Compile TypeScript to `out/` |
| `npm run compile` | Build the installable VSIX using the local scripts in `tools/` |
| `npm run watch` | Recompile when source files change |
| `npm test` | Compile and run regression, real SSH/SFTP/FTP/FTPS, and Chromium webview tests |
| `npm run lint` | Lint TypeScript, test scripts, and lint configuration |
| `npm run typecheck` | Check TypeScript without generating output |
| `npm run test:editor` | Launch an isolated Extension Host and test editor integration |
| `npm run check` | Run lint, typecheck, tests, and dependency audit |
| `npm audit` | Check production and development dependency advisories |

The automated suite includes 32 tests. Transport tests use ephemeral localhost SSH/SFTP, FTP, and FTPS servers; external credentials are not required. FTPS verifies a test certificate trusted only by the child test process. Chromium tests exercise the actual webview HTML in English and Portuguese, including saved-connection escaping and connection requests.

`npm run test:editor` separately checks actual editor activation, all contributed commands, sidebar focus, native document saving through the filesystem provider, rename/delete operations, session rejection, and diff resource identity. On Windows it uses the installed VS Code when available. Otherwise it downloads VS Code 1.85.2. Set `VSCODE_EXECUTABLE_PATH` to choose an executable or `VSCODE_TEST_VERSION` to choose a downloaded version. Test profiles and logs live under the ignored `.vscode-test/` directory. Linux needs a display, such as `xvfb-run -a npm run test:editor` in CI.

GitHub Actions runs validation on Windows and Linux with Node.js 22 and 24. The workflow installs the test browser, runs `npm run check`, and tests the Extension Host. Local verification passes; hosted CI execution requires pushing the workflow to GitHub.

Publication scripts depend on local files under the ignored `tools/` directory. `npm run compile` synchronizes version badges in both READMEs, validates the PNG marketplace icon and Activity Bar asset, then packages `tools/README.md` and restores this development README. `npm run pub` loads credentials from `tools/.env`; existing environment variables take precedence. Local analysis documents under `docs/` are ignored by Git and excluded from the distributed extension.

### Current limitations

- One active connection; simultaneous sessions, bookmarks, and bidirectional sync are not implemented.
- SSH config resolution supports a subset of directives. ProxyJump, Match, Include, and keyboard-interactive/OTP authentication are not implemented.
- The watcher observes new events rather than uploading existing files at startup, and applies no ignore filters.
- `stat` uses remote modification time as creation time because the transports do not provide a portable creation timestamp. Remote changes made outside this extension are not polled automatically.
- Search and archive execution require a POSIX shell and the corresponding tools on the server. Creation produces `.tar.gz`; extraction supports `.tar.gz`, `.tgz`, `.zip`, and `.gz`.

## Troubleshooting

- If UI actions appear outdated, reload the Extension Host window.
- If a remote connection drops, Remote Hub attempts automatic reconnect.
- If reconnect cannot recover, disconnect and connect again from the Connections view.
- If a private key cannot be read, check its path and permissions. The connection now rejects the failed attempt instead of remaining pending.
- If a document reports **Connection changed**, reopen it from the current remote explorer. Session changes intentionally block old documents and pending operations.
- If an SSH key changes, verify the fingerprint with the administrator before using **Forget SSH Host Key**.
- Search and archive actions require SSH/SFTP and the corresponding server tools: `grep`, `tar`, `unzip`, or `gunzip`.

## Roadmap

- Multi-connection simultaneous sessions
- Bookmarks / Favorites
- Bidirectional file sync

## Links

- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=AlmeidaaFelipe.remote-hub)
- [Open VSX Registry](https://open-vsx.org/extension/AlmeidaaFelipe/remote-hub)
- [GitHub Repository](https://github.com/AlmeidaaFelipe/remote-hub)
