import * as vscode from 'vscode';
import * as path from 'path';
import { SftpPanelViewProvider } from './SftpPanelViewProvider';
import { RemoteFileSystemProvider } from './RemoteFileSystemProvider';
import { ConnectionManager } from './ConnectionManager';
import { RemoteExplorerNode, RemoteExplorerProvider } from './RemoteExplorerProvider';
import { OriginalContentProvider, RemoteQuickDiffProvider, openDiffForFile } from './DiffProvider';
import { FileWatcher } from './FileWatcher';
import { AutoUploadController } from './AutoUploadController';
import { t } from './i18n';
import { buildSearchCommand, buildCompressCommand, buildExtractCommand } from './RemoteCommands';

let connectionManager: ConnectionManager;
let remoteFs: RemoteFileSystemProvider;
let fileWatcher: FileWatcher;

export function activate(context: vscode.ExtensionContext) {
  const setCtx = (key: string, value: unknown) =>
    vscode.commands.executeCommand('setContext', key, value);

  // Keep Explorer header actions visible without hovering specific rows.
  try {
    const viewCfg = vscode.workspace.getConfiguration('workbench.view');
    const alwaysShowHeaderActions = viewCfg.get<boolean>('alwaysShowHeaderActions');
    if (alwaysShowHeaderActions !== true) {
      void viewCfg.update('alwaysShowHeaderActions', true, vscode.ConfigurationTarget.Workspace).then(undefined, () => {});
    }
  } catch { /* Workspace configuration may be read-only. */ }

  connectionManager = new ConnectionManager(context);
  const originalProvider = new OriginalContentProvider();
  remoteFs = new RemoteFileSystemProvider(connectionManager, originalProvider);
  fileWatcher = new FileWatcher(connectionManager);
  context.subscriptions.push(fileWatcher, connectionManager, remoteFs, originalProvider);
  setCtx('sftpPanel.connected', false);
  setCtx('sftpPanel.showConnections', true);
  setCtx('sftpPanel.watcherActive', false);

  // Register the virtual filesystem for remote files
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('sftp', remoteFs, {
      isCaseSensitive: true,
    })
  );

  // Register the read-only original content provider for diffs
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('sftp-original', originalProvider)
  );

  // Register Source Control with QuickDiffProvider for inline gutter diffs
  const scm = vscode.scm.createSourceControl('remoteHub', t('diff.remoteHub'));
  scm.quickDiffProvider = new RemoteQuickDiffProvider();
  context.subscriptions.push(scm);

  // Register the sidebar webview
  const provider = new SftpPanelViewProvider(
    context.extensionUri,
    connectionManager
  );
  const remoteExplorerProvider = new RemoteExplorerProvider(connectionManager);
  context.subscriptions.push(provider, remoteExplorerProvider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('sftpPanel.mainView', provider)
  );
  const remoteExplorerView = vscode.window.createTreeView('sftpPanel.explorerView', {
    treeDataProvider: remoteExplorerProvider,
    showCollapseAll: true,
    dragAndDropController: remoteExplorerProvider,
  });
  context.subscriptions.push(remoteExplorerView);

  const getEffectiveNode = (node?: RemoteExplorerNode): RemoteExplorerNode | undefined => {
    const selectedNode = remoteExplorerView.selection?.[0];
    return (!node || node.type === 'connectionRoot') && selectedNode ? selectedNode : node;
  };

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpPanel.forgetSshHostKey', () => connectionManager.forgetSshHostKey()),
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
    vscode.commands.registerCommand('sftpPanel.searchRemote', async (node?: RemoteExplorerNode) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
      if (connectionManager.status !== 'connected' || !connectionManager.config) {
        vscode.window.showWarningMessage(t('connect.first'));
        return;
      }
      if (connectionManager.config.protocol !== 'ssh' && connectionManager.config.protocol !== 'sftp') {
        vscode.window.showWarningMessage(t('search.sshOnly'));
        return;
      }

      const effectiveNode = getEffectiveNode(node);
      const targetDir = remoteExplorerProvider.getTargetDirectory(effectiveNode) || '/';

      const searchTerm = await vscode.window.showInputBox({
        title: t('search.title'),
        prompt: t('search.prompt', targetDir),
        placeHolder: t('search.placeholder'),
      });

      if (!searchTerm) return;

      try {
        const resultsStr = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('progress.searching', searchTerm),
            cancellable: false,
          },
          async () => {
            const command = buildSearchCommand(searchTerm, targetDir);
            return await connectionManager.execCommand(command, [0, 1], sessionId);
          }
        );

        const lines = resultsStr.split('\n').filter(l => l.trim().length > 0);
        if (lines.length === 0) {
          vscode.window.showInformationMessage(t('search.noResults'));
          return;
        }

        interface SearchQuickPickItem extends vscode.QuickPickItem {
          filePath?: string;
          lineNumber?: number;
        }

        const items: SearchQuickPickItem[] = lines.map(line => {
          // grep output format: filepath:line:content
          const match = line.match(/^([^:]+):(\d+):(.*)$/);
          if (match) {
            return {
              label: path.posix.basename(match[1]),
              description: `Line ${match[2]} in ${path.posix.dirname(match[1])}`,
              detail: match[3].trim(),
              filePath: match[1],
              lineNumber: parseInt(match[2], 10),
            };
          }
          return { label: line };
        });

        const selected = await vscode.window.showQuickPick<SearchQuickPickItem>(items, {
          title: t('search.resultsTitle', items.length),
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (selected && selected.filePath && selected.lineNumber !== undefined) {
          await vscode.commands.executeCommand('sftpPanel.openRemoteFile', selected.filePath);
          // Wait slightly to ensure document is active before scrolling
          setTimeout(() => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.path === selected.filePath) {
              const pos = new vscode.Position(selected.lineNumber! - 1, 0);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
          }, 200);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(t('search.error', err.message || err));
      }
    }),
    vscode.commands.registerCommand('sftpPanel.openRemoteFile', async (remotePath?: string, sessionId = connectionManager.sessionId) => {
      if (!remotePath) return;
      connectionManager.assertSession(sessionId);
      await remoteFs.openRemoteFile(remotePath);
    }),
    vscode.commands.registerCommand('sftpPanel.createRemoteFile', async (node?: RemoteExplorerNode) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
      const effectiveNode = getEffectiveNode(node);
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
      await connectionManager.uploadFile(remoteFilePath, Buffer.alloc(0), sessionId);
      await remoteFs.openRemoteFile(remoteFilePath);
      remoteExplorerProvider.refresh();
    }),
    vscode.commands.registerCommand('sftpPanel.createRemoteFolder', async (node?: RemoteExplorerNode) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
      const effectiveNode = getEffectiveNode(node);
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
      await connectionManager.createDirectory(remoteFolderPath, sessionId);
      remoteExplorerProvider.refresh();
    }),
    vscode.commands.registerCommand('sftpPanel.copyRemotePath', async (node?: RemoteExplorerNode) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
      if (!node) return;
      await vscode.env.clipboard.writeText(node.remotePath);
      vscode.window.setStatusBarMessage(t('copied', node.remotePath), 2000);
    }),
    vscode.commands.registerCommand('sftpPanel.renameRemoteEntry', async (node?: RemoteExplorerNode) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
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
      await connectionManager.renamePath(node.remotePath, newPath, sessionId);
      remoteExplorerProvider.refresh();
    }),
    vscode.commands.registerCommand('sftpPanel.deleteRemoteEntry', async (node?: RemoteExplorerNode) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
      if (!node || node.type === 'connectionRoot') return;
      const label = path.posix.basename(node.remotePath);
      const answer = await vscode.window.showWarningMessage(
        t('delete.entry', label),
        { modal: true },
        t('btn.delete')
      );
      if (answer !== t('btn.delete')) return;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Deleting ${label}...`,
            cancellable: false,
          },
          async () => {
            await connectionManager.deletePath(node.remotePath, node.type === 'directory', sessionId);
          }
        );
        remoteExplorerProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delete ${label}: ${err.message || err}`);
      }
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
    }),
    vscode.commands.registerCommand('sftpPanel.diffWithRemote', async (node?: RemoteExplorerNode) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
      // If called from a tree view item
      if (node && node.type === 'file') {
        await openDiffForFile(node.remotePath, connectionManager, originalProvider);
        return;
      }
      // If called without context, try the active editor
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.scheme === 'sftp') {
        remoteFs.bindDocument(activeEditor.document.uri);
        await openDiffForFile(activeEditor.document.uri.path, connectionManager, originalProvider);
        return;
      }
      vscode.window.showWarningMessage(t('diff.noFile'));
    }),
    vscode.commands.registerCommand('sftpPanel.compressRemote', async (node?: RemoteExplorerNode, selectedNodes?: RemoteExplorerNode[]) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
      if (connectionManager.status !== 'connected' || !connectionManager.config) {
        vscode.window.showWarningMessage(t('connect.first'));
        return;
      }
      if (connectionManager.config.protocol !== 'ssh' && connectionManager.config.protocol !== 'sftp') {
        vscode.window.showWarningMessage(t('compress.sshOnly'));
        return;
      }

      // Use multi-selection if available, otherwise fall back to single node
      const nodes = (selectedNodes && selectedNodes.length > 0)
        ? selectedNodes.filter(n => n.type !== 'connectionRoot')
        : (node && node.type !== 'connectionRoot' ? [node] : []);

      if (nodes.length === 0) return;
      for (const item of nodes) connectionManager.assertSession(item.sessionId || sessionId);

      // All items must share the same parent directory
      const parentDir = path.posix.dirname(nodes[0].remotePath);
      if (nodes.some(item => path.posix.dirname(item.remotePath) !== parentDir)) {
        vscode.window.showWarningMessage('Select items from the same directory.');
        return;
      }
      const baseNames = nodes.map(n => path.posix.basename(n.remotePath));
      const archiveName = nodes.length === 1
        ? `${baseNames[0]}.tar.gz`
        : 'archive.tar.gz';
      const label = nodes.length === 1 ? baseNames[0] : `${nodes.length} items`;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('compress.progress', label),
            cancellable: false,
          },
          async () => {
            const command = buildCompressCommand(parentDir, archiveName, baseNames);
            await connectionManager.execCommand(command, [0], sessionId);
          }
        );
        remoteExplorerProvider.refresh();
        vscode.window.showInformationMessage(t('compress.done', archiveName));
      } catch (err: any) {
        vscode.window.showErrorMessage(t('compress.error', err.message || err));
      }
    }),
    vscode.commands.registerCommand('sftpPanel.extractRemote', async (node?: RemoteExplorerNode) => {
      const sessionId = node?.sessionId || connectionManager.sessionId;
      connectionManager.assertSession(sessionId);
      if (!node || node.type !== 'file') return;
      if (connectionManager.status !== 'connected' || !connectionManager.config) {
        vscode.window.showWarningMessage(t('connect.first'));
        return;
      }
      if (connectionManager.config.protocol !== 'ssh' && connectionManager.config.protocol !== 'sftp') {
        vscode.window.showWarningMessage(t('compress.sshOnly'));
        return;
      }

      const remotePath = node.remotePath;
      const baseName = path.posix.basename(remotePath);
      const command = buildExtractCommand(remotePath);
      if (!command) {
        vscode.window.showWarningMessage(t('extract.unsupported'));
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('extract.progress', baseName),
            cancellable: false,
          },
          async () => {
            await connectionManager.execCommand(command, [0], sessionId);
          }
        );
        remoteExplorerProvider.refresh();
        vscode.window.showInformationMessage(t('extract.done', baseName));
      } catch (err: any) {
        vscode.window.showErrorMessage(t('extract.error', err.message || err));
      }
    }),
    vscode.commands.registerCommand('sftpPanel.startFileWatcher', async () => {
      const sessionId = connectionManager.sessionId;
      if (connectionManager.status !== 'connected' || !connectionManager.config) {
        vscode.window.showWarningMessage(t('connect.first'));
        return;
      }

      // Warn user about the destructive nature of sync
      const confirm = await vscode.window.showWarningMessage(
        t('watcher.warning'),
        { modal: true },
        t('watcher.btnStart')
      );
      if (confirm !== t('watcher.btnStart')) return;

      const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: t('watcher.selectFolder'),
      });
      if (!folders || folders.length === 0) return;

      const localFolder = folders[0].fsPath;
      const remoteRoot = connectionManager.config.remotePath || '/';

      connectionManager.assertSession(sessionId);
      await fileWatcher.start(localFolder, remoteRoot);
      setCtx('sftpPanel.watcherActive', true);
    }),
    vscode.commands.registerCommand('sftpPanel.stopFileWatcher', () => {
      fileWatcher.stop();
      setCtx('sftpPanel.watcherActive', false);
    })
  );

  context.subscriptions.push(connectionManager.onStatusChange.event((status) => {
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
      originalProvider.clearAll();
      // Auto-stop file watcher on disconnect
      if (fileWatcher.isActive) {
        fileWatcher.stop();
        setCtx('sftpPanel.watcherActive', false);
      }
    }
  }));

  context.subscriptions.push(new AutoUploadController(remoteFs, connectionManager));

}

export function deactivate() {
  connectionManager?.disconnect();
}
