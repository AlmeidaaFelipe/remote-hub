import * as vscode from 'vscode';
import { ConnectionManager } from './ConnectionManager';
import * as path from 'path';
import { t } from './i18n';
import { originalUri } from './RemoteUri';

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
  setOriginal(remotePath: string | vscode.Uri, content: Buffer | Uint8Array): void {
    const text = Buffer.from(content).toString('utf8');
    const uri = typeof remotePath === 'string' ? vscode.Uri.from({ scheme: 'sftp', path: remotePath }) : remotePath;
    this._originals.set(originalUri(uri).toString(), text);
    // Notify VS Code that this URI content changed so it re-reads
    this._onDidChange.fire(originalUri(uri));
  }

  /** Remove original content (e.g. on disconnect) */
  clearOriginal(remotePath: string | vscode.Uri): void {
    const uri = typeof remotePath === 'string' ? vscode.Uri.from({ scheme: 'sftp-original', path: remotePath }) : originalUri(remotePath);
    this._originals.delete(uri.toString());
  }

  /** Clear all stored originals */
  clearAll(): void {
    this._originals.clear();
  }

  /** Called by VS Code when it needs the content for an sftp-original:// URI */
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._originals.get(originalUri(uri).toString()) ?? '';
  }

  dispose(): void { this.clearAll(); this._onDidChange.dispose(); }

  /** After a successful upload, update the original to match the new content */
  updateOriginalAfterUpload(remotePath: string | vscode.Uri, newContent: Buffer | Uint8Array): void {
    this.setOriginal(remotePath, newContent);
  }
}

/**
 * Tells VS Code where to find the "base" version of each sftp:// file
 * so it can compute and display inline diffs automatically.
 */
export class RemoteQuickDiffProvider implements vscode.QuickDiffProvider {
  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme === 'sftp') {
      return originalUri(uri);
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
  const session = conn.sessionId;
  const rightUri = conn.uri(remotePath);

  // Fetch the latest version from the server
  const serverContent = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t('diff.fetching', fileName),
      cancellable: false,
    },
    async () => conn.downloadFile(remotePath, session)
  );

  // Update the original provider with the fresh server content
  conn.assertSession(session);
  originalProvider.setOriginal(rightUri, serverContent);

  const leftUri = originalUri(rightUri);
  const title = t('diff.title', fileName);

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
}
