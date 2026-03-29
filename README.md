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
    <img alt="Open VSX Version" src="https://img.shields.io/open-vsx/v/AlmeidaaFelipe/remote-hub?label=Open%20VSX"></a>
  <br />
  <a href="https://marketplace.visualstudio.com/items?itemName=AlmeidaaFelipe.remote-hub">
    <img alt="VS Code Marketplace Downloads" src="https://img.shields.io/visual-studio-marketplace/d/AlmeidaaFelipe.remote-hub?label=VS%20Code%20Downloads"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=AlmeidaaFelipe.remote-hub">
    <img alt="VS Code Marketplace Version" src="https://img.shields.io/visual-studio-marketplace/v/AlmeidaaFelipe.remote-hub?label=VS%20Code"></a>
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

To build and run locally:

```bash
npm install
npm run compile
```

Press `F5` in your editor to start an Extension Development Host.

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
- **SSH Agent**: Seamless authentication for SSH/SFTP protocols. Works on Linux, macOS, and Windows (OpenSSH).

## Usage

### Connection Behavior

- Switching to a different server disconnects the current one first.
- Saved connections are stored securely via `globalState` (without passwords).

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

### Auto Upload

Remote Hub listens to editor save events and uploads edited remote files automatically.

**Flow:**

1. Open remote file (`sftp://...`)
2. Edit in editor
3. Save (`Ctrl+S` or Auto Save)
4. A progress notification appears while the upload runs in the background
5. Status bar confirms completion

## Internationalization

Remote Hub automatically adapts to your editor's language. Currently supported:

- 🇺🇸 English (default)
- 🇧🇷 Português (Brasil)

## Development

**Project structure:**

```
remote-hub/
├── src/
│   ├── media/
│   ├── extension.ts
│   ├── i18n.ts
│   ├── ConnectionManager.ts
│   ├── RemoteExplorerProvider.ts
│   ├── RemoteFileSystemProvider.ts
│   └── SftpPanelViewProvider.ts
├── package.nls.json
├── package.nls.pt-br.json
├── package.json
└── README.md
```

**Useful scripts:**

```
npm run compile
npm run watch
```

## Troubleshooting

- If UI actions appear outdated, reload the Extension Host window.
- If a remote connection drops, Remote Hub attempts automatic reconnect.
- If reconnect cannot recover, disconnect and connect again from the Connections view.

## Roadmap

- Drag and drop upload/download
- Multi-connection simultaneous sessions
- Better file operation feedback and progress UI
