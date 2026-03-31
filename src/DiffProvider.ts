import * as vscode from 'vscode';
import { ConnectionManager } from './ConnectionManager';
import * as path from 'path';
import { t } from './i18n';

/**
 * Stores the "original" content fetched from the remote server
 * for each opened file. VS Code uses this to paint inline diff
 * decorations (green/red/blue gutter markers) in the editor.
 *
 * Scheme: sftp-original://
 */
export class OriginalContentProvider implements vscode.TextDocumentContentProvider {
  private _originals = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

  /** Save the original server content for a given remote path */
  setOriginal(remotePath: string, content: Buffer | Uint8Array): void {
    const text = Buffer.from(content).toString('utf8');
    this._originals.set(remotePath, text);
    // Notify VS Code that this URI content changed so it re-reads
    this._onDidChange.fire(vscode.Uri.parse(`sftp-original://${remotePath}`));
  }

  /** Remove original content (e.g. on disconnect) */
  clearOriginal(remotePath: string): void {
    this._originals.delete(remotePath);
  }

  /** Clear all stored originals */
  clearAll(): void {
    this._originals.clear();
  }

  /** Called by VS Code when it needs the content for an sftp-original:// URI */
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._originals.get(uri.path) ?? '';
  }

  /** After a successful upload, update the original to match the new content */
  updateOriginalAfterUpload(remotePath: string, newContent: Buffer | Uint8Array): void {
    const text = Buffer.from(newContent).toString('utf8');
    this._originals.set(remotePath, text);
    this._onDidChange.fire(vscode.Uri.parse(`sftp-original://${remotePath}`));
  }
}

/**
 * Tells VS Code where to find the "base" version of each sftp:// file
 * so it can compute and display inline diffs automatically.
 */
export class RemoteQuickDiffProvider implements vscode.QuickDiffProvider {
  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme === 'sftp') {
      return vscode.Uri.parse(`sftp-original://${uri.path}`);
    }
    return undefined;
  }
}

/**
 * Opens a side-by-side diff view comparing the remote (server) version
 * with the local (edited) version of a file.
 */
export async function openDiffForFile(
  remotePath: string,
  conn: ConnectionManager,
  originalProvider: OriginalContentProvider
): Promise<void> {
  const fileName = path.posix.basename(remotePath);

  // Fetch the latest version from the server
  const serverContent = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t('diff.fetching', fileName),
      cancellable: false,
    },
    async () => conn.downloadFile(remotePath)
  );

  // Update the original provider with the fresh server content
  originalProvider.setOriginal(remotePath, serverContent);

  const leftUri = vscode.Uri.parse(`sftp-original://${remotePath}`);
  const rightUri = vscode.Uri.parse(`sftp://${remotePath}`);
  const title = t('diff.title', fileName);

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
}
