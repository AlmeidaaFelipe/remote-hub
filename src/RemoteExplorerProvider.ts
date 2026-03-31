import * as vscode from 'vscode';
import { ConnectionManager, RemoteEntry } from './ConnectionManager';
import * as path from 'path';

export type RemoteExplorerNodeType =
  | 'connectionRoot'
  | 'directory'
  | 'file';

export interface RemoteExplorerNode {
  type: RemoteExplorerNodeType;
  label: string;
  remotePath: string;
  entry?: RemoteEntry;
}

export class RemoteExplorerProvider implements vscode.TreeDataProvider<RemoteExplorerNode>, vscode.TreeDragAndDropController<RemoteExplorerNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<RemoteExplorerNode | void>();
  readonly onDidChangeTreeData: vscode.Event<RemoteExplorerNode | void> = this._onDidChangeTreeData.event;

  dropMimeTypes = ['text/uri-list', 'application/vnd.code.tree.remoteExplorerNode'];
  dragMimeTypes = ['text/uri-list', 'application/vnd.code.tree.remoteExplorerNode'];

  private _dirCache = new Map<string, RemoteEntry[]>();

  constructor(
    private readonly _conn: ConnectionManager
  ) {
    this._conn.onStatusChange.event(() => {
      this._dirCache.clear();
      this.refresh();
    });
  }

  refresh(): void {
    this._dirCache.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: RemoteExplorerNode): vscode.TreeItem {
    if (element.type === 'connectionRoot') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.tooltip = element.remotePath;
      item.iconPath = new vscode.ThemeIcon('remote');
      item.contextValue = 'remoteConnectionRoot';
      return item;
    }

    const entry = element.entry!;
    const item = new vscode.TreeItem(
      entry.name,
      entry.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.tooltip = entry.fullPath;
    // resourceUri lets VS Code resolve icons from the active file icon theme
    item.resourceUri = vscode.Uri.parse(`sftp://${entry.fullPath}`);
    item.contextValue = entry.isDirectory ? 'remoteDirectory' : 'remoteFile';

    if (element.type === 'file') {
      item.command = {
        command: 'sftpPanel.openRemoteFile',
        title: 'Open Remote File',
        arguments: [entry.fullPath],
      };
      if (typeof entry.size === 'number') {
        item.description = this._formatSize(entry.size);
      }
    }

    return item;
  }

  async getChildren(element?: RemoteExplorerNode): Promise<RemoteExplorerNode[]> {
    if (this._conn.status !== 'connected' || !this._conn.config) {
      return [];
    }

    if (!element) {
      const rootPath = this._conn.config.remotePath || '/';
      return [{
        type: 'connectionRoot',
        label: this._conn.config.label || 'Connection',
        remotePath: rootPath,
      }];
    }

    if (element.type === 'file') {
      return [];
    }

    if (element.type === 'connectionRoot') {
      const rootPath = element.remotePath;
      const entries = await this._getDirectoryEntries(rootPath);
      return entries.map((entry) => ({
        type: entry.isDirectory ? 'directory' as const : 'file' as const,
        label: entry.name,
        remotePath: entry.fullPath,
        entry,
      }));
    }

    const remotePath = element.remotePath;
    const entries = await this._getDirectoryEntries(remotePath);

    return entries.map((entry) => ({
      type: entry.isDirectory ? 'directory' : 'file',
      label: entry.name,
      remotePath: entry.fullPath,
      entry,
    }));
  }

  getTargetDirectory(node?: RemoteExplorerNode): string | undefined {
    if (!this._conn.config) return undefined;
    if (
      !node ||
      node.type === 'connectionRoot'
    ) {
      return this._conn.config.remotePath || '/';
    }
    if (node.type === 'directory') {
      return node.remotePath;
    }
    return path.posix.dirname(node.remotePath);
  }

  private async _getDirectoryEntries(remotePath: string): Promise<RemoteEntry[]> {
    const cached = this._dirCache.get(remotePath);
    if (cached) {
      return cached;
    }

    const entries = await this._conn.listDir(remotePath);
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    this._dirCache.set(remotePath, sorted);
    return sorted;
  }

  private _formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Drag & Drop Implementation
  async handleDrag(source: readonly RemoteExplorerNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const urls: string[] = source.map(node => `sftp://${node.remotePath}`);
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem(urls.join('\r\n')));
    dataTransfer.set('application/vnd.code.tree.remoteExplorerNode', new vscode.DataTransferItem(source));
  }

  async handleDrop(target: RemoteExplorerNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const targetDir = this.getTargetDirectory(target);
    if (!targetDir || this._conn.status !== 'connected') {
      return;
    }

    // Handle internal move (drag within the tree)
    const internalDragData = dataTransfer.get('application/vnd.code.tree.remoteExplorerNode');
    if (internalDragData) {
      const sourceNodes: RemoteExplorerNode[] = internalDragData.value;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Moving items...',
          cancellable: false,
        },
        async () => {
          for (const node of sourceNodes) {
            if (node.remotePath === targetDir) continue; // Skip dropping on itself
            const newPath = path.posix.join(targetDir, path.posix.basename(node.remotePath));
            if (node.remotePath !== newPath) {
              await this._conn.renamePath(node.remotePath, newPath);
            }
          }
        }
      );
      this.refresh();
      return;
    }

    // Handle external drop (upload from local)
    const externalDragData = dataTransfer.get('text/uri-list');
    if (externalDragData) {
      const urlString = await externalDragData.asString();
      const urls = urlString.split('\r\n').filter(Boolean);
      for (const url of urls) {
        const uri = vscode.Uri.parse(url);
        if (uri.scheme === 'file') {
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type === vscode.FileType.File) {
              const fileName = path.basename(uri.path);
              await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: `Uploading ${fileName}...`,
                  cancellable: false,
                },
                async () => {
                  const data = await vscode.workspace.fs.readFile(uri);
                  await this._conn.uploadFile(path.posix.join(targetDir, fileName), Buffer.from(data));
                }
              );
              vscode.window.setStatusBarMessage(`$(check) Uploaded ${fileName}`, 3000);
            } else if (stat.type === vscode.FileType.Directory) {
              // Basic support for dropping folders: just show a message for now or implement recursive later
              vscode.window.showInformationMessage('Uploading entire directories via drag & drop is not yet supported. Please drop files individually.');
            }
          } catch (err) {
            console.error(err);
          }
        }
      }
      this.refresh();
    }
  }
}
