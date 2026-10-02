import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from './ConnectionManager';
import { OriginalContentProvider } from './DiffProvider';
import { t } from './i18n';

/**
 * Provides a virtual `sftp://` URI scheme so VSCode can open remote files
 * directly in the editor. On save, we upload back automatically.
 */
export class RemoteFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  // In-memory cache of file contents
  private readonly _written = new Set<string>();
  private readonly _legacySessions = new Map<string, string>();
  private readonly _subscription: vscode.Disposable;
  private _cache = new Map<string, Uint8Array>();

  constructor(
    private _conn: ConnectionManager,
    private _originalProvider?: OriginalContentProvider
  ) {
    this._subscription = _conn.onStatusChange.event(status => {
      if (status === 'disconnected' || status === 'error') { this._cache.clear(); this._written.clear(); }
    });
  }

  bindDocument(uri: vscode.Uri): string { return this._session(uri); }

  private _session(uri: vscode.Uri): string {
    const key = uri.toString();
    const session = uri.authority || this._legacySessions.get(key) || this._conn.sessionId;
    this._legacySessions.set(key, session);
    this._conn.assertSession(session);
    return session;
  }

  dispose(): void {
    this._subscription.dispose(); this._emitter.dispose(); this._cache.clear(); this._legacySessions.clear(); this._written.clear();
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  private async _entry(uri: vscode.Uri, session: string) {
    try { return await this._conn.statPath(uri.path, session); }
    catch (error: any) {
      if (error.code === 2 || error.code === 550) throw vscode.FileSystemError.FileNotFound(uri);
      throw error;
    }
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const entry = await this._entry(uri, this._session(uri));
    return { type: entry.isDirectory ? vscode.FileType.Directory : vscode.FileType.File, ctime: entry.modifiedAt.getTime(), mtime: entry.modifiedAt.getTime(), size: entry.size };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const entries = await this._conn.listDir(uri.path, this._session(uri));
    return entries.map(entry => [entry.name, entry.isDirectory ? vscode.FileType.Directory : vscode.FileType.File]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const session = this._session(uri);
    let current = '/';
    for (const name of uri.path.split('/').filter(Boolean)) {
      current = path.posix.join(current, name);
      const directory = uri.with({ path: current });
      const entry = await this._existing(directory, session);
      if (entry && !entry.isDirectory) throw vscode.FileSystemError.FileExists(directory);
      if (!entry) {
        await this._conn.createDirectory(current, session);
        this._emitter.fire([{ type: vscode.FileChangeType.Created, uri: directory }]);
      }
    }
  }

  private async _existing(uri: vscode.Uri, session: string) {
    try { return await this._entry(uri, session); }
    catch (error: any) { if (error.code === 'FileNotFound') return undefined; throw error; }
  }

  private _invalidate(uri: vscode.Uri): void {
    for (const key of this._cache.keys()) {
      const cached = vscode.Uri.parse(key);
      if (cached.authority === uri.authority && (cached.path === uri.path || cached.path.startsWith(uri.path + '/'))) {
        this._cache.delete(key);
        this._written.delete(key);
        this._originalProvider?.clearOriginal(cached);
      }
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const session = this._session(uri);
    const cached = this._cache.get(uri.toString());
    if (cached) return cached;

    const remotePath = uri.path;
    const fileName = path.posix.basename(remotePath);

    const buf = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t('progress.downloading', fileName),
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0 });
        const result = await this._conn.downloadFile(remotePath, session);
        progress.report({ increment: 100 });
        return result;
      }
    );

    this._conn.assertSession(session);
    const bytes = new Uint8Array(buf);
    this._cache.set(uri.toString(), bytes);
    // Save the original server content for inline diff decorations
    if (this._originalProvider) {
      this._originalProvider.setOriginal(uri, buf);
    }
    return bytes;
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
    const session = this._session(uri);
    const entry = await this._existing(uri, session);
    if (entry?.isDirectory) throw vscode.FileSystemError.NoPermissions('Cannot write a directory');
    if (entry && !options.overwrite) throw vscode.FileSystemError.FileExists(uri);
    if (!entry && !options.create) throw vscode.FileSystemError.FileNotFound(uri);
    await this._upload(uri, Buffer.from(content), session);
    this._written.add(uri.toString());
    this._emitter.fire([{ type: entry ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const session = this._session(uri);
    if (uri.path === '/') throw vscode.FileSystemError.NoPermissions('Cannot delete remote root');
    const entry = await this._entry(uri, session);
    if (entry.isDirectory && !options.recursive && (await this._conn.listDir(uri.path, session)).length) {
      throw vscode.FileSystemError.NoPermissions('Directory is not empty');
    }
    await this._conn.deletePath(uri.path, entry.isDirectory, session);
    this._invalidate(uri);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    const session = this._session(oldUri);
    if (session !== this._session(newUri)) throw vscode.FileSystemError.NoPermissions('Cannot move between sessions');
    if (oldUri.path === '/' || newUri.path === '/') throw vscode.FileSystemError.NoPermissions('Cannot rename remote root');
    if (oldUri.path === newUri.path) return;
    const source = await this._entry(oldUri, session);
    if (source.isDirectory && newUri.path.startsWith(oldUri.path + '/')) throw vscode.FileSystemError.NoPermissions('Cannot move directory inside itself');
    const destination = await this._existing(newUri, session);
    if (destination && !options.overwrite) throw vscode.FileSystemError.FileExists(newUri);
    if (destination) await this._conn.deletePath(newUri.path, destination.isDirectory, session);
    await this._conn.renamePath(oldUri.path, newUri.path, session);
    this._invalidate(oldUri); this._invalidate(newUri);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri: oldUri }, { type: vscode.FileChangeType.Created, uri: newUri }]);
  }

  private async _upload(uri: vscode.Uri, content: Buffer, session: string): Promise<void> {
    const fileName = path.posix.basename(uri.path);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('progress.uploading', fileName), cancellable: false }, async () => {
      this._conn.assertSession(session);
      await this._conn.uploadFile(uri.path, content, session);
      this._conn.assertSession(session);
    });
    this._cache.set(uri.toString(), content);
    this._originalProvider?.updateOriginalAfterUpload(uri, content);
    vscode.window.setStatusBarMessage(t('uploaded', fileName), 3000);
  }

  /** Called by extension.ts on every save of an sftp:// document */
  async uploadOnSave(doc: vscode.TextDocument): Promise<void> {
    const session = this._session(doc.uri);
    if (this._written.delete(doc.uri.toString())) return;
    await this._upload(doc.uri, Buffer.from(doc.getText(), 'utf8'), session);
  }

  /** Open a remote file in the VSCode editor */
  async openRemoteFile(remotePath: string): Promise<void> {
    const uri = this._conn.uri(remotePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}
