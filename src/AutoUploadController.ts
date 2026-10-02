import * as vscode from 'vscode';
import { RemoteFileSystemProvider } from './RemoteFileSystemProvider';
import { t } from './i18n';
import { ConnectionManager } from './ConnectionManager';

/** Owns the save subscription and its debounced uploads. */
export class AutoUploadController implements vscode.Disposable {
  private readonly _pending = new Map<string, NodeJS.Timeout>();
  private readonly _subscription: vscode.Disposable;

  private readonly _statusSubscription?: vscode.Disposable;

  constructor(private readonly _remoteFs: RemoteFileSystemProvider, connection?: ConnectionManager) {
    this._statusSubscription = connection?.onStatusChange.event(status => {
      if (status === 'disconnected' || status === 'error') this._clear();
    });
    this._subscription = vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.uri.scheme !== 'sftp') return;
      try { this._remoteFs.bindDocument?.(doc.uri); } catch (error: any) { vscode.window.showErrorMessage(error.message); return; }
      const key = doc.uri.toString();
      const existing = this._pending.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(async () => {
        this._pending.delete(key);
        try {
          await this._remoteFs.uploadOnSave(doc);
        } catch (err: any) {
          vscode.window.showErrorMessage(t('upload.failed', err?.message ?? err));
        }
      }, 700);
      this._pending.set(key, timer);
    });
  }

  dispose(): void {
    this._subscription.dispose();
    this._statusSubscription?.dispose();
    this._clear();
  }

  private _clear(): void {
    for (const timer of this._pending.values()) clearTimeout(timer);
    this._pending.clear();
  }
}
