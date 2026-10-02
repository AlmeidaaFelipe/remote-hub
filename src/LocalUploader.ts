import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from './ConnectionManager';

/** Uploads folders sequentially, preserving empty directories and session identity. */
export async function uploadLocalEntry(connection: ConnectionManager, uri: vscode.Uri, remotePath: string, sessionId: string, token?: vscode.CancellationToken): Promise<void> {
  connection.assertSession(sessionId);
  if (token?.isCancellationRequested) throw new vscode.CancellationError();
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type & vscode.FileType.SymbolicLink) throw new Error(`Symbolic links are not uploaded: ${uri.fsPath}`);
  if (stat.type & vscode.FileType.Directory) {
    let existing;
    try { existing = await connection.statPath(remotePath, sessionId); }
    catch (error: any) { if (error.code !== 2 && error.code !== 550) throw error; }
    if (existing && !existing.isDirectory) throw new Error(`Destination is not a directory: ${remotePath}`);
    if (!existing) await connection.createDirectory(remotePath, sessionId);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    for (const [name] of entries) {
      await uploadLocalEntry(connection, uri.with({ path: path.posix.join(uri.path, name) }), path.posix.join(remotePath, name), sessionId, token);
    }
  } else if (stat.type & vscode.FileType.File) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    connection.assertSession(sessionId);
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    await connection.uploadFile(remotePath, Buffer.from(bytes), sessionId);
  } else {
    throw new Error(`Unsupported local file type: ${uri.fsPath}`);
  }
}
