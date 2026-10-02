const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
class EventEmitter { event() { return { dispose() {} }; } fire() {} dispose() {} }
Module._load = function(name, ...args) {
  return name === 'vscode' ? { EventEmitter } : load.call(this, name, ...args);
};
const { ConnectionManager } = require('../../out/ConnectionManager');
(async () => {
  const manager = new ConnectionManager({ globalState: { get: (_, fallback) => fallback, update: async () => {} }, secrets: { get: async () => undefined, store: async () => {} } });
  try {
    await manager.connect({ label: 'test', protocol: process.argv[2], host: '127.0.0.1', port: Number(process.argv[3]), username: 'user', password: 'secret', authType: 'password', remotePath: '/' });
    assert.equal((await manager.downloadFile('/original.txt')).toString(), 'original');
    await manager.createDirectory('/folder');
    const binary = Buffer.from([0, 1, 127, 128, 255]);
    await manager.uploadFile('/folder/file', binary);
    assert.deepEqual(await manager.downloadFile('/folder/file'), binary);
    assert.equal((await manager.statPath('/folder/file')).size, binary.length);
    assert.equal((await manager.listDir('/folder'))[0].name, 'file');
    await manager.renamePath('/folder/file', '/folder/new');
    await manager.deletePath('/folder/new', false);
    assert.deepEqual(await manager.listDir('/folder'), []);
    await manager.deletePath('/folder', true);
    process.stdout.write('FTP transport assertions passed\n');
  } finally { manager.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
