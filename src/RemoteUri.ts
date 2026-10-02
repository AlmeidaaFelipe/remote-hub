import * as vscode from 'vscode';

/** Session authority prevents documents from following a later connection. */
export function remoteUri(remotePath: string, sessionId: string, scheme = 'sftp'): vscode.Uri {
  return vscode.Uri.from({ scheme, authority: sessionId, path: remotePath.startsWith('/') ? remotePath : '/' + remotePath });
}

export function originalUri(uri: vscode.Uri): vscode.Uri { return uri.with({ scheme: 'sftp-original' }); }
