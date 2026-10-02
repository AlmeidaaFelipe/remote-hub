const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');
exports.run = async function() {
  const extension = vscode.extensions.getExtension('AlmeidaaFelipe.remote-hub');
  assert.ok(extension, 'Extension is discovered');
  await extension.activate();
  assert.ok(extension.isActive, 'Extension activates');
  const manifest = require('../../package.json');
  const commands = await vscode.commands.getCommands(true);
  for (const { command } of manifest.contributes.commands) assert.ok(commands.includes(command), command);
  await vscode.commands.executeCommand('workbench.view.extension.sftp-panel');
  await vscode.commands.executeCommand('sftpPanel.mainView.focus');
  const { OriginalContentProvider, RemoteQuickDiffProvider } = require('../../out/DiffProvider');
  const original = new OriginalContentProvider();
  const session = 'editor-test';
  const uri = vscode.Uri.from({ scheme: 'sftp', authority: session, path: '/special #?.txt' });
  original.setOriginal(uri, Buffer.from('baseline'));
  const resource = new RemoteQuickDiffProvider().provideOriginalResource(uri);
  assert.equal(resource.authority, session);
  assert.equal(original.provideTextDocumentContent(resource), 'baseline');
  const registration = vscode.workspace.registerTextDocumentContentProvider('remote-hub-test-original', { provideTextDocumentContent: () => 'baseline' });
  try {
    const document = await vscode.workspace.openTextDocument(resource.with({ scheme: 'remote-hub-test-original' }));
    await vscode.window.showTextDocument(document, { preview: false });
    assert.equal(vscode.window.activeTextEditor.document.getText(), 'baseline');
  } finally { registration.dispose(); original.dispose(); }
  const { ConnectionManager } = require('../../out/ConnectionManager');
  const { RemoteFileSystemProvider } = require('../../out/RemoteFileSystemProvider');
  const manager = new ConnectionManager({ globalState: { get: (_, fallback) => fallback, update: async () => {} }, secrets: {} });
  const files = new Map([['/', null]]);
  manager.statPath = async name => {
    if (!files.has(name)) throw Object.assign(new Error('missing'), { code: 2 });
    const content = files.get(name);
    return { isDirectory: content === null, size: content?.length || 0, modifiedAt: new Date() };
  };
  manager.uploadFile = async (name, content) => files.set(name, Buffer.from(content));
  manager.downloadFile = async name => files.get(name);
  manager.createDirectory = async name => files.set(name, null);
  manager.listDir = async directory => [...files].filter(([name]) => name !== directory && path.posix.dirname(name) === directory).map(([name, content]) => ({ name: path.posix.basename(name), isDirectory: content === null }));
  manager.renamePath = async (oldName, newName) => { files.set(newName, files.get(oldName)); files.delete(oldName); };
  manager.deletePath = async name => files.delete(name);
  const remote = new RemoteFileSystemProvider(manager);
  const filesystem = vscode.workspace.registerFileSystemProvider('remote-hub-fs-test', remote, { isCaseSensitive: true });
  const nativeUri = vscode.Uri.from({ scheme: 'remote-hub-fs-test', authority: manager.sessionId, path: '/folder/file.txt' });
  try {
    await vscode.workspace.fs.createDirectory(nativeUri.with({ path: '/folder' }));
    await vscode.workspace.fs.writeFile(nativeUri, Buffer.from('before'));
    const document = await vscode.workspace.openTextDocument(nativeUri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    await editor.edit(edit => edit.replace(new vscode.Range(0, 0, document.lineCount, 0), 'after'));
    assert.ok(await document.save(), 'Native save succeeds');
    assert.equal(files.get('/folder/file.txt').toString(), 'after');
    await vscode.workspace.fs.rename(nativeUri, nativeUri.with({ path: '/folder/renamed.txt' }));
    assert.equal(files.has('/folder/renamed.txt'), true);
    await vscode.workspace.fs.delete(nativeUri.with({ path: '/folder/renamed.txt' }));
    assert.equal(files.has('/folder/renamed.txt'), false);
    manager.disconnect();
    await assert.rejects(remote.readFile(nativeUri), /Connection changed/);
  } finally { filesystem.dispose(); remote.dispose(); manager.dispose(); }
  await vscode.commands.executeCommand('sftpPanel.disconnect');
  console.log('Extension Host checks passed: activation, commands, view, native filesystem saving and session-aware diff.');
  assert.ok(path.isAbsolute(extension.extensionPath));
};
