import * as vscode from 'vscode';
import { ConnectionManager, ConnectionConfig } from './ConnectionManager';
import { getWebviewLocale } from './i18n';

export class SftpPanelViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _conn: ConnectionManager
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    // Dispose previous listeners to avoid duplicate messages
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml();

    // Forward logs to webview
    this._disposables.push(
      this._conn.onLog.event((msg) => {
        this._post({ type: 'log', message: msg });
      })
    );

    // Forward status changes
    this._disposables.push(
      this._conn.onStatusChange.event((status) => {
        this._post({ type: 'statusChange', status });
      })
    );

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'connect':
          await this._handleConnect(msg.config as ConnectionConfig);
          break;

        case 'disconnect':
          this._conn.disconnect();
          this._post({ type: 'statusChange', status: 'disconnected' });
          break;

        case 'getSavedConnections':
          this._post({
            type: 'savedConnections',
            connections: this._conn.getSavedConnections(),
          });
          break;

        case 'deleteConnection': {
          await this._conn.deleteConnection(msg.label);
          this._post({
            type: 'savedConnections',
            connections: this._conn.getSavedConnections(),
          });
          break;
        }
      }
    });

    // Send saved connections when panel opens
    this._post({
      type: 'savedConnections',
      connections: this._conn.getSavedConnections(),
    });
  }

  refreshSavedConnections() {
    this._post({
      type: 'savedConnections',
      connections: this._conn.getSavedConnections(),
    });
  }

  private async _handleConnect(config: ConnectionConfig) {
    try {
      await this._conn.connect(config);
    } catch (err: any) {
      this._post({ type: 'error', message: err.message });
    }
  }

  private _post(msg: object) {
    this._view?.webview.postMessage(msg);
  }

  private _getHtml(): string {
    const l = getWebviewLocale();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root {
    --bg: var(--vscode-sideBar-background);
    --fg: var(--vscode-foreground);
    --border: var(--vscode-panel-border);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --list-hover: var(--vscode-list-hoverBackground);
    --list-active: var(--vscode-list-activeSelectionBackground);
    --list-active-fg: var(--vscode-list-activeSelectionForeground);
    --accent: var(--vscode-focusBorder);
    --error: var(--vscode-inputValidation-errorBorder);
    --warning: var(--vscode-editorWarning-foreground);
    --success: var(--vscode-terminal-ansiGreen);
    --font-mono: var(--vscode-editor-font-family, 'Courier New', monospace);
    --font-size: var(--vscode-font-size, 13px);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--font-size);
    color: var(--fg);
    background: var(--bg);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .icon-btn {
    background: none; border: none; color: var(--fg);
    cursor: pointer; padding: 3px 5px; border-radius: 3px;
    opacity: 0.7; font-size: 14px; line-height: 1;
  }
  .icon-btn:hover { opacity: 1; background: var(--list-hover); }

  /* ── Status bar ── */
  .status-bar {
    font-size: 11px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .status-dot {
    width: 7px; height: 7px; border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.disconnected { background: #666; }
  .status-dot.connecting   { background: var(--warning); animation: pulse 1s infinite; }
  .status-dot.connected    { background: var(--success); }
  .status-dot.error        { background: var(--error); }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

  /* ── Main scroll area ── */
  .main { flex: 1; overflow-y: auto; overflow-x: hidden; }

  /* ── Section ── */
  .section { border-bottom: 1px solid var(--border); }
  .section-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; cursor: pointer; user-select: none;
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; opacity: 0.6;
  }
  .section-header:hover { opacity: 1; background: var(--list-hover); }
  .chevron { transition: transform 0.15s; font-size: 10px; }
  .section-header.collapsed .chevron { transform: rotate(-90deg); }
  .section-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
  .section-body.hidden { display: none; }

  /* ── Form ── */
  .field { display: flex; flex-direction: column; gap: 3px; }
  .field label { font-size: 11px; opacity: 0.7; }
  .field input, .field select {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 2px;
    padding: 4px 6px;
    font-size: 12px;
    font-family: inherit;
    width: 100%;
    outline: none;
  }
  .field input:focus, .field select:focus {
    border-color: var(--accent);
  }
  .row { display: flex; gap: 6px; }
  .row .field { flex: 1; }
  .row .field.narrow { flex: 0 0 70px; }

  .btn {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none; border-radius: 2px;
    padding: 5px 10px; font-size: 12px;
    cursor: pointer; width: 100%;
    font-family: inherit;
  }
  .btn:hover { background: var(--btn-hover); }
  .btn.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    opacity: 0.8;
  }
  .btn.secondary:hover { opacity: 1; background: var(--list-hover); }
  .btn.danger { background: #c0392b; color: #fff; }
  .btn.danger:hover { background: #e74c3c; }

  /* ── Saved connections ── */
  .saved-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 5px 6px; border-radius: 2px; cursor: pointer;
    font-size: 12px; border: 1px solid transparent;
  }
  .saved-item:hover { background: var(--list-hover); border-color: var(--border); }
  .saved-item-label { font-weight: 500; }
  .saved-item-host { opacity: 0.6; font-size: 11px; }
  .saved-item-proto {
    font-size: 10px; padding: 1px 4px; border-radius: 2px;
    background: var(--list-active); color: var(--list-active-fg);
    text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;
  }
  /* ── Log ── */
  .log-area {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 10px;
    max-height: 110px;
    overflow-y: auto;
    opacity: 0.75;
    line-height: 1.5;
    background: var(--vscode-terminal-background, transparent);
  }
  .log-line { white-space: pre-wrap; word-break: break-all; }
  .log-line.ok  { color: var(--success); }
  .log-line.err { color: var(--error); }

  .tree-empty  { padding: 6px 14px; font-size: 11px; opacity: 0.4; font-style: italic; }

  .divider { height: 1px; background: var(--border); margin: 4px 0; }
</style>
</head>
<body>

<!-- Connect View -->
<div id="connect-view">
  <!-- Saved connections -->
  <div class="section" id="sect-saved">
    <div class="section-header" onclick="toggleSection('saved')">
      <span>${l['wv.savedConnections']}</span>
      <span class="chevron">▾</span>
    </div>
    <div class="section-body" id="saved-body">
      <div id="saved-list" style="display:flex;flex-direction:column;gap:4px;"></div>
      <div id="saved-empty" class="tree-empty">${l['wv.noSaved']}</div>
    </div>
  </div>

  <!-- New Connection form -->
  <div class="section" id="sect-new">
    <div class="section-header" onclick="toggleSection('new')">
      <span>${l['wv.newConnection']}</span>
      <span class="chevron">▾</span>
    </div>
    <div class="section-body" id="new-body">
      <div class="field">
        <label>${l['wv.label']}</label>
        <input id="f-label" type="text" placeholder="My Server"/>
      </div>
      <div class="row">
        <div class="field">
          <label>${l['wv.protocol']}</label>
          <select id="f-proto">
            <option value="ssh">SSH</option>
            <option value="sftp">SFTP</option>
            <option value="ftp">FTP</option>
            <option value="ftps">FTPS</option>
          </select>
        </div>
        <div class="field narrow">
          <label>${l['wv.port']}</label>
          <input id="f-port" type="number" value="22"/>
        </div>
      </div>
      <div class="field">
        <label>${l['wv.host']}</label>
        <input id="f-host" type="text" placeholder="example.com"/>
      </div>
      <div class="field">
        <label>${l['wv.username']}</label>
        <input id="f-user" type="text" placeholder="ubuntu"/>
      </div>
      <div class="field" id="auth-wrap">
        <label>${l['wv.auth']}</label>
        <select id="f-auth" onchange="updateAuthFields()">
          <option value="password">Password</option>
          <option value="privateKey">Private Key</option>
          <option value="agent">SSH Agent</option>
        </select>
      </div>
      <div class="field" id="f-pass-wrap">
        <label>${l['wv.password']}</label>
        <input id="f-pass" type="password" placeholder="••••••••"/>
      </div>
      <div class="field" id="f-key-wrap" style="display:none">
        <label>${l['wv.privateKey']}</label>
        <input id="f-key" type="text" placeholder="~/.ssh/id_rsa"/>
      </div>
      <div class="field">
        <label>${l['wv.remotePath']}</label>
        <input id="f-path" type="text" value="/"/>
      </div>
      <button class="btn" onclick="doConnect()">${l['wv.btnConnect']}</button>
    </div>
  </div>
</div>

<!-- Log panel (always visible at bottom) -->
<div class="log-area" id="log-area"></div>
<!-- Status bar -->
<div class="status-bar">
  <div class="status-dot disconnected" id="status-dot"></div>
  <span id="status-text">${l['wv.disconnected']}</span>
</div>

<script>
const vscode = acquireVsCodeApi();
let savedConnections = [];
const i18n = ${JSON.stringify(l)};

// ── Section toggle ──────────────────────────────────────────
function toggleSection(id) {
  const body = document.getElementById(id + '-body');
  const hdr  = document.getElementById('sect-' + id).querySelector('.section-header');
  body.classList.toggle('hidden');
  hdr.classList.toggle('collapsed');
}

// ── Auth fields toggle ──────────────────────────────────────
function updateAuthFields() {
  const v = document.getElementById('f-auth').value;
  document.getElementById('f-pass-wrap').style.display = v === 'password'   ? '' : 'none';
  document.getElementById('f-key-wrap').style.display  = v === 'privateKey' ? '' : 'none';
}

// ── Protocol ↔ Port sync ────────────────────────────────────
document.getElementById('f-proto').addEventListener('change', () => {
  const proto = document.getElementById('f-proto').value;
  const portEl = document.getElementById('f-port');
  if (proto === 'ssh')  portEl.value = 22;
  if (proto === 'sftp') portEl.value = 22;
  if (proto === 'ftp')  portEl.value = 21;
  if (proto === 'ftps') portEl.value = 990;
  // Agent only makes sense for SSH-like protocols
  const authSel = document.getElementById('f-auth');
  if (proto !== 'sftp' && proto !== 'ssh') {
    [...authSel.options].forEach(o => o.disabled = o.value === 'agent');
    if (authSel.value === 'agent') { authSel.value = 'password'; updateAuthFields(); }
  } else {
    [...authSel.options].forEach(o => o.disabled = false);
  }
});

// ── Connect ─────────────────────────────────────────────────
function doConnect(prefill) {
  const config = prefill || {
    label:          document.getElementById('f-label').value || document.getElementById('f-host').value,
    protocol:       document.getElementById('f-proto').value,
    host:           document.getElementById('f-host').value,
    port:           parseInt(document.getElementById('f-port').value),
    username:       document.getElementById('f-user').value,
    authType:       document.getElementById('f-auth').value,
    password:       document.getElementById('f-pass').value,
    privateKeyPath: document.getElementById('f-key').value,
    remotePath:     document.getElementById('f-path').value || '/',
  };
  if (!config.host) { appendLog('✗ ' + i18n['wv.hostRequired'], 'err'); return; }
  vscode.postMessage({ type: 'connect', config });
}

// ── Saved connections ────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encodeContextLabel(label) {
  try {
    return btoa(unescape(encodeURIComponent(String(label ?? ''))));
  } catch (_) {
    return '';
  }
}

function renderSaved(connections) {
  savedConnections = Array.isArray(connections) ? connections : [];
  const list  = document.getElementById('saved-list');
  const empty = document.getElementById('saved-empty');
  if (!savedConnections.length) { list.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';
  list.innerHTML = savedConnections.map((c, index) => {
    const context = JSON.stringify({
      webviewSection: 'savedConnection',
      labelB64: encodeContextLabel(c.label),
    }).replace(/"/g, '&quot;');
    return \`
    <div class="saved-item" data-index="\${index}" data-vscode-context="\${context}">
      <div style="flex:1">
        <div class="saved-item-label">\${escapeHtml(c.label)}</div>
        <div class="saved-item-host">\${escapeHtml(c.username)}@\${escapeHtml(c.host)}:\${escapeHtml(c.port)}</div>
      </div>
      <div style="display:flex; align-items:center; gap:2px">
        <button class="icon-btn saved-connect-btn" title="\${i18n['wv.btnConnect']}">▶</button>
        <span class="saved-item-proto" style="margin-left:4px">\${escapeHtml(c.protocol)}</span>
      </div>
    </div>
  \`;
  }).join('');
} 

function fillSavedConnectionForm(c) {
  document.getElementById('f-label').value = c.label;
  document.getElementById('f-proto').value = c.protocol;
  document.getElementById('f-port').value  = c.port;
  document.getElementById('f-host').value  = c.host;
  document.getElementById('f-user').value  = c.username;
  document.getElementById('f-auth').value  = c.authType;
  document.getElementById('f-path').value  = c.remotePath;
  document.getElementById('f-key').value   = c.privateKeyPath || '';
  updateAuthFields();
  
  // Expand new connection section to show the filled form
  const body = document.getElementById('new-body');
  if (body.classList.contains('hidden')) toggleSection('new');
}

function loadSavedByIndex(index) {
  const c = savedConnections[index];
  if (!c) return;
  fillSavedConnectionForm(c);
  // Keep current behavior when clicking the row: only prefill (or ask for password focus)
  if (c.authType === 'password') {
    document.getElementById('f-pass').focus();
    appendLog('ℹ️ ' + i18n['wv.passwordRequired'].replace('{0}', c.label || c.host), '');
  }
}

function connectSavedByIndex(index) {
  const c = savedConnections[index];
  if (!c) return;
  fillSavedConnectionForm(c);
  const config = { ...c };
  if (config.authType === 'password') {
    const password = document.getElementById('f-pass').value;
    if (!password) {
      appendLog('✗ ' + i18n['wv.enterPassword'].replace('{0}', config.label || config.host), 'err');
      const passEl = document.getElementById('f-pass');
      if (passEl) passEl.focus();
      return;
    }
    config.password = password;
  }
  doConnect(config);
}

const savedListEl = document.getElementById('saved-list');
savedListEl.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const item = target.closest('.saved-item');
  if (!item) return;
  const index = parseInt(item.dataset.index, 10);
  if (Number.isNaN(index)) return;
  if (target.closest('.saved-connect-btn')) {
    connectSavedByIndex(index);
    return;
  }
  loadSavedByIndex(index);
});

// ── Log ─────────────────────────────────────────────────────
function appendLog(msg, cls) {
  const area = document.getElementById('log-area');
  const line = document.createElement('div');
  line.className = 'log-line' + (cls ? ' ' + cls : '');
  line.textContent = msg;
  area.appendChild(line);
  area.scrollTop = area.scrollHeight;
}

// ── Status ──────────────────────────────────────────────────
function setStatus(status, label) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.className  = 'status-dot ' + status;
  text.textContent = label || capitalize(status);
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Message handler ──────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  switch (msg.type) {
    case 'log':
      const isErr = msg.message.includes('✗') || msg.message.includes('failed');
      const isOk  = msg.message.includes('✓');
      appendLog(msg.message, isErr ? 'err' : isOk ? 'ok' : '');
      break;

    case 'statusChange':
      const labels = { 
        disconnected: i18n['wv.disconnected'], 
        connecting: i18n['wv.connecting'] || 'Connecting...', 
        connected: i18n['wv.connected'] || 'Connected', 
        error: i18n['wv.statusError'] || 'Error' 
      };
      setStatus(msg.status, labels[msg.status] || capitalize(msg.status));
      break;

    case 'savedConnections':
      renderSaved(msg.connections);
      break;

    case 'error':
      appendLog('✗ ' + msg.message, 'err');
      break;
  }
});

// Init
vscode.postMessage({ type: 'getSavedConnections' });
</script>
</body>
</html>`;
  }
}
