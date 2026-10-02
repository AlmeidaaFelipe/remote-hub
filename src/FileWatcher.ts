import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from './ConnectionManager';
import { t } from './i18n';

export class FileWatcher {
  private _sessionId = '';
  private _generation = 0;
  private readonly _statusSubscription: vscode.Disposable;
  private _watcher: vscode.FileSystemWatcher | null = null;
  private _statusBarItem: vscode.StatusBarItem;
  private _localRoot: string = '';
  private _remoteRoot: string = '';
  private _active: boolean = false;
  private _debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly _debounceMs = 500;

  readonly onDidChangeActive = new vscode.EventEmitter<boolean>();

  constructor(
    private readonly _conn: ConnectionManager
  ) {
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left, 50
    );
    this._statusBarItem.command = 'sftpPanel.stopFileWatcher';
    this._statusSubscription = _conn.onStatusChange.event(status => {
      if (status === 'disconnected' || status === 'error') this.stop();
    });
  }

  get isActive(): boolean {
    return this._active;
  }

  get localRoot(): string {
    return this._localRoot;
  }

  async start(localFolder: string, remoteRoot: string): Promise<void> {
    // Stop any existing watcher first
    this.stop();

    this._sessionId = this._conn.sessionId;
    this._localRoot = localFolder;
    this._remoteRoot = remoteRoot;

    const pattern = new vscode.RelativePattern(localFolder, '**/*');
    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this._watcher.onDidCreate((uri) => this._onFileEvent('create', uri));
    this._watcher.onDidChange((uri) => this._onFileEvent('change', uri));
    this._watcher.onDidDelete((uri) => this._onFileEvent('delete', uri));

    this._active = true;
    this.onDidChangeActive.fire(true);

    const folderName = path.basename(localFolder);
    this._statusBarItem.text = `$(eye) Watching: ${folderName}`;
    this._statusBarItem.tooltip = t('watcher.tooltip', localFolder, remoteRoot);
    this._statusBarItem.show();

    vscode.window.showInformationMessage(t('watcher.started', folderName));
  }

  stop(): void {
    this._generation++;
    if (this._watcher) {
      this._watcher.dispose();
      this._watcher = null;
    }

    // Clear pending debounce timers
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();

    if (this._active) {
      this._active = false;
      this.onDidChangeActive.fire(false);
      this._statusBarItem.hide();
      vscode.window.setStatusBarMessage(t('watcher.stopped'), 3000);
    }
  }

  private _onFileEvent(type: 'create' | 'change' | 'delete', uri: vscode.Uri): void {
    if (!this._active || this._conn.status !== 'connected') {
      return;
    }

    const key = uri.fsPath;
    const existing = this._debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const generation = this._generation;
    const timer = setTimeout(() => {
      this._debounceTimers.delete(key);
      void this._processEvent(type, uri, generation);
    }, this._debounceMs);

    this._debounceTimers.set(key, timer);
  }

  private async _processEvent(type: 'create' | 'change' | 'delete', uri: vscode.Uri, generation = this._generation): Promise<void> {
    const sessionId = this._sessionId;
    const check = () => {
      this._conn.assertSession(sessionId);
      if (!this._active || generation !== this._generation) throw new vscode.CancellationError();
    };
    const relativePath = path.relative(this._localRoot, uri.fsPath);
    if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) return;
    // Convert Windows backslashes to posix forward slashes
    const posixRelative = relativePath.split(path.sep).join(path.posix.sep);
    const remotePath = path.posix.join(this._remoteRoot, posixRelative);
    const fileName = path.basename(uri.fsPath);

    try {
      check();
      if (type === 'create' || type === 'change') {
        // Check if it's a file (not a directory)
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          check();
          if (stat.type === vscode.FileType.Directory) {
            // Create directory on remote
            if (type === 'create') {
              await this._conn.createDirectory(remotePath, sessionId);
            }
            return;
          }
        } catch {
          return; // File may have been deleted already
        }

        const data = await vscode.workspace.fs.readFile(uri);
        check();
        await this._conn.uploadFile(remotePath, Buffer.from(data), sessionId);
        vscode.window.setStatusBarMessage(`$(cloud-upload) Synced: ${fileName}`, 2000);
      } else if (type === 'delete') {
        try {
          await this._conn.deletePath(remotePath, false, sessionId);
        } catch {
          check();
          // May be a directory deletion; try directory delete
          try {
            await this._conn.deletePath(remotePath, true, sessionId);
          } catch {
            // Silently ignore if remote path doesn't exist
          }
        }
        vscode.window.setStatusBarMessage(`$(trash) Deleted remote: ${fileName}`, 2000);
      }
    } catch (err: any) {
      if (generation !== this._generation || sessionId !== this._conn.sessionId) return;
      vscode.window.showWarningMessage(t('watcher.syncError', fileName, err.message || err));
    }
  }

  dispose(): void {
    this.stop();
    this._statusSubscription.dispose();
    this._statusBarItem.dispose();
    this.onDidChangeActive.dispose();
  }
}
