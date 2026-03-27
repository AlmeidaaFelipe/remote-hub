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

export class RemoteExplorerProvider implements vscode.TreeDataProvider<RemoteExplorerNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<RemoteExplorerNode | void>();
  readonly onDidChangeTreeData: vscode.Event<RemoteExplorerNode | void> = this._onDidChangeTreeData.event;

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
      item.contextValue = 'remoteConnectionRoot';
      return item;
    }

    const entry = element.entry!;
    const item = new vscode.TreeItem(
      entry.name,
      entry.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.tooltip = entry.fullPath;
    item.resourceUri = vscode.Uri.parse(`sftp://${entry.fullPath}`);
    item.iconPath = entry.isDirectory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
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
}
