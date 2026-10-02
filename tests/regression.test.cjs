const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
class EventEmitter {
  listeners = new Set();
  event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
const vscode = {
  EventEmitter,
  env: { language: 'en' },
  ProgressLocation: { Notification: 15 },
  window: {
    withProgress: async (_, action) => action({ report() {} }),
    setStatusBarMessage() {}, showErrorMessage() {}, showWarningMessage: async () => 'Trust and connect',
  },
  Uri: require('vscode-uri').URI,
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  FileSystemError: Object.fromEntries(['Unavailable','FileNotFound','FileExists','NoPermissions'].map(name => [name, value => Object.assign(new Error(name + ': ' + value), { code: name })])),
  Disposable: class { constructor(action) { this.dispose = action; } },
};
const originalLoad = Module._load;
Module._load = function(id, ...args) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
const { ConnectionManager } = require('../out/ConnectionManager');
const { OriginalContentProvider, RemoteQuickDiffProvider } = require('../out/DiffProvider');
const { RemoteFileSystemProvider } = require('../out/RemoteFileSystemProvider');
function fixture() {
  const state = new Map(), secrets = new Map();
  const manager = new ConnectionManager({
    globalState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) },
    secrets: { get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key) },
  });
  return { manager, state, secrets };
}
const config = { label: 'server', protocol: 'ftp', host: 'example.test', port: 21, username: 'user', authType: 'password', password: 'secret', remotePath: '/', savePassword: true };
test('saved connections exclude passwords and leave caller untouched', async () => {
  const { manager, state, secrets } = fixture();
  await manager.saveConnection(config);
  assert.equal(state.get('savedConnections')[0].password, undefined);
  assert.equal(config.password, 'secret');
  assert.equal(secrets.get('remotehub:ftp://user@example.test:21'), 'secret');
  assert.equal(await manager.getStoredPassword(config), 'secret');
});
test('saved list caps at ten; replacing label preserves position', async () => {
  const { manager } = fixture();
  for (let i = 0; i < 12; i++) await manager.saveConnection({ ...config, label: String(i) });
  assert.deepEqual(manager.getSavedConnections().map(c => c.label), ['11','10','9','8','7','6','5','4','3','2']);
  await manager.saveConnection({ ...config, label: '8', host: 'updated' });
  assert.equal(manager.getSavedConnections()[3].host, 'updated');
});
test('delete removes saved record and matching secret', async () => {
  const { manager, secrets } = fixture();
  await manager.saveConnection(config);
  await manager.deleteConnection(config.label);
  assert.deepEqual(manager.getSavedConnections(), []);
  assert.equal(secrets.size, 0);
});
test('password opt-out never writes secret', async () => {
  const { manager, secrets } = fixture();
  await manager.saveConnection({ ...config, savePassword: false });
  assert.equal(secrets.size, 0);
});
test('FTP operations serialize and queue continues after rejection', async () => {
  const { manager } = fixture();
  manager._config = config;
  let active = 0, maxActive = 0;
  manager._client = { list: async name => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    if (name === 'bad') throw new Error('permission denied');
    return [{ name, isDirectory: false, size: 3, modifiedAt: new Date(0) }];
  } };
  const outcomes = await Promise.allSettled([manager.listDir('one'), manager.listDir('bad'), manager.listDir('two')]);
  assert.equal(maxActive, 1);
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[2].value[0].fullPath, 'two/two');
});
test('lost FTP connection retries once and preserves status events', async () => {
  const { manager } = fixture();
  const statuses = [];
  manager.onStatusChange.event(status => statuses.push(status));
  manager._config = config;
  manager._client = { list: async () => { throw new Error('Client is closed'); }, close() {} };
  manager._connectFtp = async () => { manager._client = { list: async () => [] }; };
  assert.deepEqual(await manager.listDir('/'), []);
  assert.deepEqual(statuses, ['connecting', 'connected']);
});
test('disconnected operations reject without reconnect', async () => {
  const { manager } = fixture();
  await assert.rejects(manager.listDir('/'), /Not connected/);
});
test('SFTP directory entries retain path, type, size and mtime', async () => {
  const { manager } = fixture();
  manager._config = { ...config, protocol: 'sftp' }; manager._client = {};
  manager._sftp = { readdir: (_, callback) => callback(null, [{ filename: 'folder', attrs: { isDirectory: () => true, size: 42, mtime: 123 } }]) };
  assert.deepEqual(await manager.listDir('/root'), [{ name: 'folder', fullPath: '/root/folder', isDirectory: true, size: 42, modifiedAt: new Date(123000) }]);
});
test('diff baseline changes only after upload succeeds', async () => {
  const { manager } = fixture();
  const original = new OriginalContentProvider();
  original.setOriginal('/file', Buffer.from('old'));
  const provider = new RemoteFileSystemProvider(manager, original);
  const uri = vscode.Uri.parse('sftp:///file');
  manager.uploadFile = async () => { throw new Error('permission denied'); };
  await assert.rejects(provider.uploadOnSave({ uri, getText: () => 'new' }), /permission denied/);
  assert.equal(original.provideTextDocumentContent(uri), 'old');
  manager.uploadFile = async () => {};
  await provider.uploadOnSave({ uri, getText: () => 'new' });
  assert.equal(original.provideTextDocumentContent(uri), 'new');
});
test('remote read caches bytes and records original baseline', async () => {
  const { manager } = fixture(); let reads = 0;
  manager.downloadFile = async () => { reads++; return Buffer.from('content'); };
  const original = new OriginalContentProvider();
  const provider = new RemoteFileSystemProvider(manager, original);
  const uri = vscode.Uri.parse('sftp:///file');
  assert.equal(Buffer.from(await provider.readFile(uri)).toString(), 'content');
  await provider.readFile(uri);
  assert.equal(reads, 1);
  assert.equal(original.provideTextDocumentContent(uri), 'content');
});
test('quick diff only handles sftp resources', () => {
  const provider = new RemoteQuickDiffProvider();
  assert.equal(provider.provideOriginalResource(vscode.Uri.parse('file:///file')), undefined);
  assert.equal(provider.provideOriginalResource(vscode.Uri.parse('sftp:///file')).scheme, 'sftp-original');
});
test('shell commands quote apostrophes and keep option-like names as operands', () => {
  const { buildSearchCommand, buildCompressCommand, buildExtractCommand } = require('../out/RemoteCommands');
  assert.equal(buildSearchCommand("it's", "/home/o'neil"), "grep -rnI --exclude-dir=node_modules -e 'it'\\''s' -- '/home/o'\\''neil'");
  assert.equal(buildCompressCommand('/root', 'archive.tar.gz', ['--checkpoint=1', "it's"]), "cd '/root' && tar -czf 'archive.tar.gz' -- '--checkpoint=1' 'it'\\''s'");
  assert.equal(buildExtractCommand('/root/a.zip'), "cd '/root' && unzip -o './a.zip'");
  assert.equal(buildExtractCommand('/root/a.gz'), "cd '/root' && gunzip -k -- 'a.gz'");
  assert.equal(buildExtractCommand('/root/a.txt'), undefined);
});
test('watcher releases timers, status bar and event listeners on disposal', async () => {
  const { FileWatcher } = require('../out/FileWatcher');
  const { manager } = fixture();
  let disposed = false;
  vscode.StatusBarAlignment = { Left: 1 };
  vscode.window.createStatusBarItem = () => ({ dispose() { disposed = true; }, hide() {}, show() {} });
  const watcher = new FileWatcher(manager);
  watcher.dispose();
  assert.equal(disposed, true);
});
test('SFTP private key read failure rejects rather than leaving connect pending', async () => {
  const { manager } = fixture();
  await assert.rejects(manager._connectSftp({ ...config, protocol: 'sftp', authType: 'privateKey', privateKeyPath: 'missing-key-for-regression-test' }), /ENOENT/);
});
test('auto-upload debounces remote saves, ignores local saves and cancels on dispose', async () => {
  const { AutoUploadController } = require('../out/AutoUploadController');
  const saved = new EventEmitter();
  vscode.workspace = { onDidSaveTextDocument: saved.event };
  const timers = new Map(); let nextId = 0;
  const originalSetTimeout = global.setTimeout, originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback, delay) => { assert.equal(delay, 700); const id = ++nextId; timers.set(id, callback); return id; };
  global.clearTimeout = id => timers.delete(id);
  try {
    const uploaded = [];
    const controller = new AutoUploadController({ uploadOnSave: async doc => uploaded.push(doc.getText()) });
    saved.fire({ uri: vscode.Uri.parse('file:///local') });
    assert.equal(timers.size, 0);
    const uri = vscode.Uri.parse('sftp:///file');
    saved.fire({ uri, getText: () => 'first' });
    saved.fire({ uri, getText: () => 'last' });
    assert.equal(timers.size, 1);
    const callback = [...timers.values()][0]; timers.clear();
    await callback();
    assert.deepEqual(uploaded, ['last']);
    saved.fire({ uri, getText: () => 'cancelled' });
    controller.dispose();
    assert.equal(timers.size, 0);
    assert.equal(saved.listeners.size, 0);
  } finally {
    global.setTimeout = originalSetTimeout; global.clearTimeout = originalClearTimeout;
  }
});
test('extension activation registers every contributed command and disposes save listener', () => {
  const { activate, deactivate } = require('../out/extension');
  const manifest = require('../package.json');
  const commands = new Map();
  const disposable = () => ({ dispose() {} });
  vscode.Disposable = class { constructor(action) { this.dispose = action; } };
  vscode.ConfigurationTarget = { Workspace: 2 };
  vscode.commands = {
    executeCommand: async () => {},
    registerCommand: (name, callback) => { commands.set(name, callback); return disposable(); },
  };
  const saved = new EventEmitter();
  vscode.workspace = {
    getConfiguration: () => ({ get: () => true }),
    registerFileSystemProvider: disposable,
    registerTextDocumentContentProvider: disposable,
    onDidSaveTextDocument: saved.event,
  };
  vscode.window.registerWebviewViewProvider = disposable;
  vscode.window.createTreeView = () => ({ selection: [], dispose() {} });
  vscode.scm = { createSourceControl: disposable };
  const context = {
    subscriptions: [], extensionUri: vscode.Uri.parse('file:///extension'),
    globalState: { get: (_, fallback) => fallback, update: async () => {} },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
  };
  activate(context);
  for (const { command } of manifest.contributes.commands) assert.equal(typeof commands.get(command), 'function', command);
  assert.equal(saved.listeners.size, 1);
  deactivate();
  for (const subscription of context.subscriptions) subscription.dispose();
  assert.equal(saved.listeners.size, 0);
});
test('real SSH/SFTP transport connects, transfers bytes and executes command on localhost', { timeout: 15000 }, async () => {
  const { Server, utils } = require('ssh2');
  const { once } = require('node:events');
  const { manager } = fixture();
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const clients = new Set();
  let bytes = Buffer.from('original');
  const server = new Server({ hostKeys: [hostKey] }, client => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', context => {
      if (context.method === 'password' && context.username === 'user' && context.password === 'secret') context.accept();
      else context.reject();
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('exec', (accept, _, info) => { const stream = accept(); stream.write(info.command); stream.exit(0); stream.end(); });
      session.on('sftp', accept => {
        const sftp = accept();
        const attributes = () => ({ mode: 0o100644, size: bytes.length, uid: 0, gid: 0, atime: 0, mtime: 123 });
        sftp.on('OPEN', (id, _, flags) => { if (flags & 8) bytes = Buffer.alloc(0); sftp.handle(id, Buffer.from('file')); });
        sftp.on('FSTAT', id => sftp.attrs(id, attributes()));
        sftp.on('STAT', id => sftp.attrs(id, attributes()));
        sftp.on('READ', (id, _, offset, length) => {
          if (offset >= bytes.length) sftp.status(id, 1);
          else sftp.data(id, bytes.subarray(offset, offset + length));
        });
        sftp.on('WRITE', (id, _, offset, data) => {
          const content = Buffer.alloc(Math.max(bytes.length, offset + data.length));
          bytes.copy(content); data.copy(content, offset); bytes = content; sftp.status(id, 0);
        });
        sftp.on('CLOSE', id => sftp.status(id, 0));
      });
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await manager.connect({ ...config, protocol: 'sftp', host: '127.0.0.1', port: server.address().port });
    assert.equal(manager.status, 'connected');
    assert.equal((await manager.downloadFile('/file')).toString(), 'original');
    const content = Buffer.from([0, 1, 127, 128, 255]);
    await manager.uploadFile('/file', content);
    assert.deepEqual(await manager.downloadFile('/file'), content);
    assert.equal(await manager.execCommand('transport-check'), 'transport-check');
  } finally {
    manager.disconnect();
    for (const client of clients) client.end();
    await new Promise(resolve => server.close(resolve));
  }
});

test('queued operation from an old connection never runs on a new server', async () => {
  const { manager } = fixture();
  manager._config = config;
  let release; const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  manager._client = { list: async () => { calls++; await gate; return []; }, close() {} };
  const first = manager.listDir('/first');
  const pending = manager.listDir('/second');
  const outcomes = Promise.allSettled([first, pending]);
  await new Promise(resolve => setImmediate(resolve));
  manager.disconnect();
  manager._config = { ...config, host: 'other.test' };
  manager._client = { list: async () => { calls++; return []; } };
  release();
  const result = await outcomes;
  assert.equal(calls, 1);
  assert.equal(result[1].status, 'rejected');
});
test('legacy document cannot upload after switching connections', async () => {
  const { manager } = fixture();
  manager.downloadFile = async () => Buffer.from('old server');
  let uploaded = 0; manager.uploadFile = async () => uploaded++;
  const provider = new RemoteFileSystemProvider(manager);
  const uri = vscode.Uri.parse('sftp:///shared.txt');
  await provider.readFile(uri);
  manager.disconnect();
  await assert.rejects(provider.uploadOnSave({ uri, getText: () => 'new' }), /Connection changed/);
  assert.equal(uploaded, 0);
});
test('filesystem creates directories, uploads bytes, lists, renames and deletes with options', async () => {
  const { manager } = fixture();
  const entries = new Map([['/', { isDirectory: true, size: 0, modifiedAt: new Date(0) }]]);
  manager.statPath = async name => {
    if (!entries.has(name)) throw Object.assign(new Error('missing'), { code: 2 });
    return { fullPath: name, ...entries.get(name) };
  };
  manager.createDirectory = async name => entries.set(name, { isDirectory: true, size: 0, modifiedAt: new Date(0) });
  manager.uploadFile = async (name, bytes) => entries.set(name, { isDirectory: false, size: bytes.length, modifiedAt: new Date(0), bytes });
  manager.listDir = async name => [...entries].filter(([key]) => key !== name && require('node:path').posix.dirname(key) === name).map(([fullPath, entry]) => ({ name: require('node:path').posix.basename(fullPath), fullPath, ...entry }));
  manager.renamePath = async (oldName, newName) => { entries.set(newName, entries.get(oldName)); entries.delete(oldName); };
  manager.deletePath = async name => entries.delete(name);
  const provider = new RemoteFileSystemProvider(manager);
  const uri = manager.uri('/folder/file');
  await provider.createDirectory(manager.uri('/folder'));
  await provider.writeFile(uri, Uint8Array.from([0, 128, 255]), { create: true, overwrite: false });
  assert.deepEqual(entries.get('/folder/file').bytes, Buffer.from([0, 128, 255]));
  assert.equal((await provider.stat(uri)).size, 3);
  assert.deepEqual(await provider.readDirectory(manager.uri('/folder')), [['file', vscode.FileType.File]]);
  await assert.rejects(provider.writeFile(uri, Buffer.from('bad'), { create: true, overwrite: false }), /FileExists/);
  await assert.rejects(provider.writeFile(manager.uri('/missing'), Buffer.from('bad'), { create: false, overwrite: true }), /FileNotFound/);
  await provider.rename(uri, manager.uri('/folder/new'), { overwrite: false });
  assert.equal(entries.has('/folder/file'), false);
  await assert.rejects(provider.delete(manager.uri('/folder'), { recursive: false }), /not empty/);
  await provider.delete(manager.uri('/folder/new'), { recursive: false });
  assert.equal(entries.has('/folder/new'), false);
});
test('host trust requires consent, remembers fingerprint and rejects changes', async () => {
  const { HostKeyVerifier } = require('../out/HostKeyVerifier');
  const state = new Map(); let prompts = 0;
  const verifier = new HostKeyVerifier({ get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) });
  vscode.window.showWarningMessage = async () => { prompts++; return 'Trust and connect'; };
  assert.equal(await verifier.verify('host', 22, Buffer.from('key1')), true);
  assert.equal(await verifier.verify('host', 22, Buffer.from('key1')), true);
  assert.equal(prompts, 1);
  assert.equal(await verifier.verify('host', 22, Buffer.from('key2')), false);
  assert.equal(prompts, 1);
  vscode.window.showWarningMessage = async () => undefined;
  assert.equal(await verifier.verify('other', 22, Buffer.from('key')), false);
});
test('recursive local upload preserves nested and empty folders and rejects stale session', async () => {
  const { uploadLocalEntry } = require('../out/LocalUploader');
  const { manager } = fixture(); const session = manager.sessionId;
  const created = [], files = [];
  manager.statPath = async () => { throw Object.assign(new Error('missing'), { code: 2 }); };
  manager.createDirectory = async name => created.push(name);
  manager.uploadFile = async (name, data) => files.push([name, data.toString()]);
  vscode.workspace.fs = {
    stat: async uri => ({ type: uri.path.endsWith('.txt') ? 1 : 2 }),
    readDirectory: async uri => uri.path === '/local' ? [['nested', 2], ['empty', 2]] : uri.path === '/local/nested' ? [['file.txt', 1]] : [],
    readFile: async () => Buffer.from('content'),
  };
  await uploadLocalEntry(manager, vscode.Uri.parse('file:///local'), '/remote/local', session);
  assert.deepEqual(created, ['/remote/local', '/remote/local/nested', '/remote/local/empty']);
  assert.deepEqual(files, [['/remote/local/nested/file.txt', 'content']]);
  manager.disconnect();
  await assert.rejects(uploadLocalEntry(manager, vscode.Uri.parse('file:///local'), '/remote/local', session), /Connection changed/);
});
test('session-aware cache and original content stay isolated for identical paths', async () => {
  const { manager } = fixture();
  manager.downloadFile = async () => Buffer.from('server A');
  const original = new OriginalContentProvider(); const provider = new RemoteFileSystemProvider(manager, original);
  const first = manager.uri('/same #?.txt');
  assert.equal(first.path, '/same #?.txt');
  assert.equal(Buffer.from(await provider.readFile(first)).toString(), 'server A');
  manager.disconnect();
  manager.downloadFile = async () => Buffer.from('server B');
  const second = manager.uri('/same #?.txt');
  assert.equal(Buffer.from(await provider.readFile(second)).toString(), 'server B');
  assert.equal(original.provideTextDocumentContent(first), 'server A');
  assert.equal(original.provideTextDocumentContent(second), 'server B');
  await assert.rejects(provider.readFile(first), /Connection changed/);
  provider.dispose(); original.dispose();
});
test('filesystem-confirmed saves are not uploaded a second time by save fallback', async () => {
  const { manager } = fixture(); let uploads = 0;
  manager.statPath = async () => ({ isDirectory: false });
  manager.uploadFile = async () => uploads++;
  const provider = new RemoteFileSystemProvider(manager);
  const uri = manager.uri('/file');
  await provider.writeFile(uri, Buffer.from('saved'), { create: false, overwrite: true });
  await provider.uploadOnSave({ uri, getText: () => 'saved' });
  assert.equal(uploads, 1);
  provider.dispose();
});
test('webview disposes message and connection listeners when resolved again or closed', () => {
  const { SftpPanelViewProvider } = require('../out/SftpPanelViewProvider');
  const { manager } = fixture(); const messages = new EventEmitter(), closed = new EventEmitter();
  const view = { webview: { onDidReceiveMessage: messages.event, postMessage() {} }, onDidDispose: closed.event };
  const provider = new SftpPanelViewProvider(vscode.Uri.parse('file:///extension'), manager);
  provider.resolveWebviewView(view, {}, {});
  provider.resolveWebviewView(view, {}, {});
  assert.equal(messages.listeners.size, 1);
  assert.equal(manager.onLog.listeners.size, 1);
  closed.fire();
  assert.equal(messages.listeners.size, 0);
  assert.equal(manager.onLog.listeners.size, 0);
  assert.equal(manager.onStatusChange.listeners.size, 0);
});
test('watcher cancels an upload when stopped during a local read', async () => {
  const { FileWatcher } = require('../out/FileWatcher'); const { manager } = fixture();
  vscode.CancellationError = class extends Error {};
  manager._status = 'connected'; let uploaded = 0, release;
  manager.uploadFile = async () => uploaded++;
  const gate = new Promise(resolve => { release = resolve; });
  vscode.workspace.fs = { stat: async () => ({ type: vscode.FileType.File }), readFile: async () => { await gate; return Buffer.from('content'); } };
  const watcher = new FileWatcher(manager);
  watcher._active = true; watcher._sessionId = manager.sessionId; watcher._localRoot = '/local'; watcher._remoteRoot = '/remote';
  const processing = watcher._processEvent('change', vscode.Uri.parse('file:///local/file.txt'));
  await new Promise(resolve => setImmediate(resolve));
  watcher.stop(); release(); await processing;
  assert.equal(uploaded, 0); watcher.dispose();
});
test('shell execution treats exit codes by operation and propagates stream errors', async () => {
  const { manager } = fixture(); manager._config = { ...config, protocol: 'ssh' };
  let code = 1, fail = false;
  manager._client = { exec: (_, callback) => {
    const stream = new (require('node:events').EventEmitter)(); stream.stderr = new (require('node:events').EventEmitter)();
    callback(null, stream);
    setImmediate(() => { if (fail) stream.emit('error', new Error('stream failed')); else { stream.emit('data', Buffer.from('output')); stream.emit('close', code); } });
  } };
  await assert.rejects(manager.execCommand('tar'), /code 1/);
  assert.equal(await manager.execCommand('grep', [0, 1]), 'output');
  code = 2; await assert.rejects(manager.execCommand('tar'), /code 2/);
  fail = true; await assert.rejects(manager.execCommand('tar'), /stream failed/);
});
test('watcher and explorer release connection subscriptions and status emitters', () => {
  const { manager } = fixture();
  const { FileWatcher } = require('../out/FileWatcher'); const { RemoteExplorerProvider } = require('../out/RemoteExplorerProvider');
  const watcher = new FileWatcher(manager), explorer = new RemoteExplorerProvider(manager), provider = new RemoteFileSystemProvider(manager);
  assert.equal(manager.onStatusChange.listeners.size, 3);
  watcher.dispose(); explorer.dispose(); provider.dispose();
  assert.equal(manager.onStatusChange.listeners.size, 0);
});
