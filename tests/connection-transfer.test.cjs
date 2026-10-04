const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectionStore } = require('../out/ConnectionStore');
const config = { label: 'server', protocol: 'sftp', host: 'example.test', port: 22, username: 'user', authType: 'password', remotePath: '/', password: 'secret', savePassword: true };
function fixture(saved = []) {
  let records = saved;
  let updates = 0;
  const store = new ConnectionStore({ get: () => records, update: async (_, value) => { records = value; updates++; } }, {});
  return { store, updates: () => updates };
}
test('export round trip excludes credentials and arbitrary fields', async () => {
  const { store } = fixture([{ ...config, privateKey: 'sensitive' }]);
  const json = store.exportConnections();
  assert.equal(json.includes('secret'), false);
  assert.equal(json.includes('sensitive'), false);
  const target = fixture();
  assert.deepEqual(await target.store.importConnections(json), { imported: 1, skipped: 0 });
  assert.deepEqual(target.store.getSavedConnections(), [{ label: 'server', protocol: 'sftp', host: 'example.test', port: 22, username: 'user', authType: 'password', remotePath: '/', savePassword: false }]);
});
test('import preserves existing connections and skips duplicate labels', async () => {
  const { store, updates } = fixture([config]);
  const json = JSON.stringify({ format: 'remote-hub', version: 1, connections: [config, { ...config, label: 'new' }, { ...config, label: 'new' }] });
  assert.deepEqual(await store.importConnections(json), { imported: 1, skipped: 2 });
  assert.equal(store.getSavedConnections()[0], config);
  assert.equal(store.getSavedConnections()[1].password, undefined);
  assert.equal(updates(), 1);
});
test('invalid documents and overflow leave storage untouched', async () => {
  const { store, updates } = fixture();
  for (const value of [null, [], {}, { format: 'remote-hub', version: 2, connections: [] }, ...[null, { ...config, port: 0 }, { ...config, port: 1.5 }, { ...config, protocol: 'http' }, { ...config, host: '' }, { ...config, authType: 'unknown' }, { ...config, protocol: 'ftp', authType: 'agent' }, { ...config, authType: 'privateKey' }].map(c => ({ format: 'remote-hub', version: 1, connections: [config, c] }))]) {
    await assert.rejects(store.importConnections(JSON.stringify(value)));
  }
  await assert.rejects(store.importConnections('{'));
  await assert.rejects(store.importConnections(JSON.stringify({ format: 'remote-hub', version: 1, connections: Array.from({ length: 11 }, (_, i) => ({ ...config, label: String(i) })) })));
  assert.equal(updates(), 0);
});
