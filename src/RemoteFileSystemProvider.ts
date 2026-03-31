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
  private _cache = new Map<string, Uint8Array>();

  constructor(
    private _conn: ConnectionManager,
    private _originalProvider?: OriginalContentProvider
  ) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    return {
      type: vscode.FileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      size: this._cache.get(uri.toString())?.byteLength ?? 0,
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {}

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
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
        const result = await this._conn.downloadFile(remotePath);
        progress.report({ increment: 100 });
        return result;
      }
    );

    const bytes = new Uint8Array(buf);
    this._cache.set(uri.toString(), bytes);
    // Save the original server content for inline diff decorations
    if (this._originalProvider) {
      this._originalProvider.setOriginal(remotePath, buf);
    }
    return bytes;
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    this._cache.set(uri.toString(), content);
    // Actual upload happens in uploadOnSave (triggered by onDidSaveTextDocument)
  }

  delete(): void {}
  rename(): void {}

  /** Called by extension.ts on every save of an sftp:// document */
  async uploadOnSave(doc: vscode.TextDocument): Promise<void> {
    const remotePath = doc.uri.path;
    const fileName = path.posix.basename(remotePath);
    const content = Buffer.from(doc.getText(), 'utf8');
    this._cache.set(doc.uri.toString(), content);

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t('progress.uploading', fileName),
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0 });
          await this._conn.uploadFile(remotePath, content);
          progress.report({ increment: 100 });
        }
      );
      vscode.window.setStatusBarMessage(t('uploaded', fileName), 3000);
      // Update the original baseline after successful upload
      if (this._originalProvider) {
        this._originalProvider.updateOriginalAfterUpload(remotePath, content);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(t('upload.failed', err.message));
    }
  }

  /** Open a remote file in the VSCode editor */
  async openRemoteFile(remotePath: string): Promise<void> {
    const uri = vscode.Uri.parse(`sftp://${remotePath}`);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}
