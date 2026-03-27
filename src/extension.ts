import * as vscode from 'vscode';
import * as path from 'path';
import { SftpPanelViewProvider } from './SftpPanelViewProvider';
import { RemoteFileSystemProvider } from './RemoteFileSystemProvider';
import { ConnectionManager } from './ConnectionManager';
import { RemoteExplorerNode, RemoteExplorerProvider } from './RemoteExplorerProvider';
import { t } from './i18n';

let connectionManager: ConnectionManager;
let remoteFs: RemoteFileSystemProvider;
const AUTO_SAVE_DEBOUNCE_MS = 700;

export function activate(context: vscode.ExtensionContext) {
  const setCtx = (key: string, value: unknown) =>
    vscode.commands.executeCommand('setContext', key, value);

  // Keep Explorer header actions visible without hovering specific rows.
  try {
    const viewCfg = vscode.workspace.getConfiguration('workbench.view');
    const alwaysShowHeaderActions = viewCfg.get<boolean>('alwaysShowHeaderActions');
    if (alwaysShowHeaderActions !== true) {
      viewCfg.update('alwaysShowHeaderActions', true, vscode.ConfigurationTarget.Workspace);
    }
  } catch (_) {}

  connectionManager = new ConnectionManager(context);
  remoteFs = new RemoteFileSystemProvider(connectionManager);
  setCtx('sftpPanel.connected', false);
  setCtx('sftpPanel.showConnections', true);

  // Register the virtual filesystem for remote files
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('sftp', remoteFs, {
      isCaseSensitive: true,
    })
  );

  // Register the sidebar webview
  const provider = new SftpPanelViewProvider(
    context.extensionUri,
    connectionManager
  );
  const remoteExplorerProvider = new RemoteExplorerProvider(connectionManager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('sftpPanel.mainView', provider)
  );
  const remoteExplorerView = vscode.window.createTreeView('sftpPanel.explorerView', {
    treeDataProvider: remoteExplorerProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(remoteExplorerView);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpPanel.connect', () => {
      setCtx('sftpPanel.showConnections', true);
      vscode.commands.executeCommand('workbench.view.extension.sftp-panel');
      vscode.commands.executeCommand('sftpPanel.mainView.focus');
    }),
    vscode.commands.registerCommand('sftpPanel.disconnect', () => {
      connectionManager.disconnect();
      remoteExplorerProvider.refresh();
      setCtx('sftpPanel.showConnections', true);
    }),
    vscode.commands.registerCommand('sftpPanel.goToConnections', () => {
      setCtx('sftpPanel.showConnections', true);
      vscode.commands.executeCommand('sftpPanel.mainView.focus');
    }),
    vscode.commands.registerCommand('sftpPanel.goToExplorer', () => {
      setCtx('sftpPanel.showConnections', false);
      remoteExplorerProvider.refresh();
      vscode.commands.executeCommand('sftpPanel.explorerView.focus');
    }),
    vscode.commands.registerCommand('sftpPanel.stopConnection', () => {
      connectionManager.disconnect();
      remoteExplorerProvider.refresh();
      setCtx('sftpPanel.showConnections', true);
      vscode.commands.executeCommand('sftpPanel.mainView.focus');
    }),
    vscode.commands.registerCommand('sftpPanel.refreshExplorer', () => {
      remoteExplorerProvider.refresh();
    }),
    vscode.commands.registerCommand('sftpPanel.openRemoteFile', async (remotePath?: string) => {
      if (!remotePath) return;
      await remoteFs.openRemoteFile(remotePath);
    }),
    vscode.commands.registerCommand('sftpPanel.createRemoteFile', async (node?: RemoteExplorerNode) => {
      const selectedNode = remoteExplorerView.selection?.[0];
      const effectiveNode =
        (!node || node.type === 'connectionRoot') && selectedNode
          ? selectedNode
          : node;
      const targetDir = remoteExplorerProvider.getTargetDirectory(effectiveNode);
      if (!targetDir || connectionManager.status !== 'connected') {
        vscode.window.showWarningMessage(t('connect.first'));
        return;
      }

      const name = await vscode.window.showInputBox({
        title: t('new.file'),
        prompt: t('create.file.in', targetDir),
        placeHolder: t('filename.txt'),
        validateInput: (value) => {
          const v = value.trim();
          if (!v) return t('file.required');
          if (path.posix.isAbsolute(v)) return t('file.relative');
          return undefined;
        },
      });
      if (!name) return;

      const remoteFilePath = path.posix.join(targetDir, name.trim());
      await connectionManager.uploadFile(remoteFilePath, Buffer.alloc(0));
      await remoteFs.openRemoteFile(remoteFilePath);
      remoteExplorerProvider.refresh();
    }),
    vscode.commands.registerCommand('sftpPanel.createRemoteFolder', async (node?: RemoteExplorerNode) => {
      const selectedNode = remoteExplorerView.selection?.[0];
      const effectiveNode =
        (!node || node.type === 'connectionRoot') && selectedNode
          ? selectedNode
          : node;
      const targetDir = remoteExplorerProvider.getTargetDirectory(effectiveNode);
      if (!targetDir || connectionManager.status !== 'connected') {
        vscode.window.showWarningMessage(t('connect.first'));
        return;
      }

      const name = await vscode.window.showInputBox({
        title: t('new.folder'),
        prompt: t('create.folder.in', targetDir),
        placeHolder: t('new.folder.placeholder'),
        validateInput: (value) => {
          const v = value.trim();
          if (!v) return t('folder.required');
          if (path.posix.isAbsolute(v)) return t('folder.relative');
          return undefined;
        },
      });
      if (!name) return;

      const remoteFolderPath = path.posix.join(targetDir, name.trim());
      await connectionManager.createDirectory(remoteFolderPath);
      remoteExplorerProvider.refresh();
    }),
    vscode.commands.registerCommand('sftpPanel.copyRemotePath', async (node?: RemoteExplorerNode) => {
      if (!node) return;
      await vscode.env.clipboard.writeText(node.remotePath);
      vscode.window.setStatusBarMessage(t('copied', node.remotePath), 2000);
    }),
    vscode.commands.registerCommand('sftpPanel.renameRemoteEntry', async (node?: RemoteExplorerNode) => {
      if (!node || node.type === 'connectionRoot') return;
      const currentName = path.posix.basename(node.remotePath);
      const newName = await vscode.window.showInputBox({
        title: t('rename.entry'),
        value: currentName,
        validateInput: (value) => {
          const v = value.trim();
          if (!v) return t('name.required');
          if (v.includes('/')) return t('name.no.slash');
          return undefined;
        },
      });
      if (!newName || newName.trim() === currentName) return;

      const parent = path.posix.dirname(node.remotePath);
      const newPath = path.posix.join(parent, newName.trim());
      await connectionManager.renamePath(node.remotePath, newPath);
      remoteExplorerProvider.refresh();
    }),
    vscode.commands.registerCommand('sftpPanel.deleteRemoteEntry', async (node?: RemoteExplorerNode) => {
      if (!node || node.type === 'connectionRoot') return;
      const label = path.posix.basename(node.remotePath);
      const answer = await vscode.window.showWarningMessage(
        t('delete.entry', label),
        { modal: true },
        t('btn.delete')
      );
      if (answer !== t('btn.delete')) return;
      await connectionManager.deletePath(node.remotePath, node.type === 'directory');
      remoteExplorerProvider.refresh();
    }),
    vscode.commands.registerCommand('sftpPanel.deleteSavedConnectionFromContext', async (ctx?: any) => {
      const label =
        typeof ctx?.label === 'string'
          ? ctx.label
          : typeof ctx?.labelB64 === 'string'
            ? Buffer.from(ctx.labelB64, 'base64').toString('utf8')
            : undefined;
      if (!label) return;
      const answer = await vscode.window.showWarningMessage(
        t('delete.saved', label),
        { modal: true },
        t('btn.delete')
      );
      if (answer !== t('btn.delete')) return;
      await connectionManager.deleteConnection(label);
      provider.refreshSavedConnections();
    })
  );

  connectionManager.onStatusChange.event((status) => {
    if (status === 'connected') {
      setCtx('sftpPanel.connected', true);
      setCtx('sftpPanel.showConnections', false);
      remoteExplorerProvider.refresh();
      vscode.commands.executeCommand('sftpPanel.explorerView.focus');
      return;
    }
    if (status === 'disconnected' || status === 'error') {
      setCtx('sftpPanel.connected', false);
      setCtx('sftpPanel.showConnections', true);
      remoteExplorerProvider.refresh();
    }
  });

  // Auto-upload on save for remote files
  const pendingUploadTimers = new Map<string, NodeJS.Timeout>();
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (doc.uri.scheme === 'sftp') {
        const key = doc.uri.toString();
        const existing = pendingUploadTimers.get(key);
        if (existing) {
          clearTimeout(existing);
        }

        const timer = setTimeout(async () => {
          pendingUploadTimers.delete(key);
          try {
            await remoteFs.uploadOnSave(doc);
          } catch (err: any) {
            vscode.window.showErrorMessage(t('upload.failed', err?.message ?? err));
          }
        }, AUTO_SAVE_DEBOUNCE_MS);

        pendingUploadTimers.set(key, timer);
      }
    })
  );
  context.subscriptions.push(
    new vscode.Disposable(() => {
      for (const timer of pendingUploadTimers.values()) {
        clearTimeout(timer);
      }
      pendingUploadTimers.clear();
    })
  );
}

export function deactivate() {
  connectionManager?.disconnect();
}
