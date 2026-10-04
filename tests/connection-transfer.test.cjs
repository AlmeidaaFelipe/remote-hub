const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectionStore } = require('../out/ConnectionStore');
const config = { label: 'server', protocol: 'sftp', host: 'example.test', port: 22, username: 'user', authType: 'password', remotePath: '/', password: 'secret', savePassword: true };
function fixture(saved = []) {
  let records = saved;
  let updates = 0;
  const secrets = new Map();
  const store = new ConnectionStore({ get: () => records, update: async (_, value) => { records = value; updates++; } }, {
    get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key),
  });
  return { store, secrets, updates: () => updates };
}
test('export round trip excludes credentials and arbitrary fields', async () => {
  const { store } = fixture([{ ...config, privateKey: 'sensitive' }]);
  const json = await store.exportConnections();
  assert.equal(json.includes('secret'), false);
  assert.equal(json.includes('sensitive'), false);
  const target = fixture();
  assert.deepEqual(await target.store.importConnections(json), { imported: 1, skipped: 0 });
  assert.deepEqual(target.store.getSavedConnections(), [{ label: 'server', protocol: 'sftp', host: 'example.test', port: 22, username: 'user', authType: 'password', remotePath: '/', savePassword: false }]);
});
test('password export is opt-in and only reads saved password credentials', async () => {
  const { store, secrets } = fixture([config, { ...config, label: 'agent', authType: 'agent' }]);
  secrets.set('remotehub:sftp://user@example.test:22', 'stored-secret');
  assert.equal((await store.exportConnections()).includes('stored-secret'), false);
  const json = await store.exportConnections(true);
  const records = JSON.parse(json).connections;
  assert.equal(records[0].password, 'stored-secret');
  assert.equal(records[1].password, undefined);
  const target = fixture();
  await target.store.importConnections(json, true);
  assert.equal(await target.store.getStoredPassword(config), 'stored-secret');
  assert.equal(target.store.getSavedConnections()[0].password, undefined);
  assert.equal(target.store.getSavedConnections()[0].savePassword, true);
  const without = fixture();
  await without.store.importConnections(json);
  assert.equal(without.secrets.size, 0);
});
test('invalid passwords reject before metadata or secrets change; duplicate labels do not overwrite secrets', async () => {
  const { store, secrets, updates } = fixture([config]);
  secrets.set('remotehub:sftp://user@example.test:22', 'original');
  const document = { format: 'remote-hub', version: 1, connections: [config] };
  await store.importConnections(JSON.stringify(document), true);
  assert.equal(await store.getStoredPassword(config), 'original');
  document.connections.push({ ...config, label: 'new', password: 123 });
  await assert.rejects(store.importConnections(JSON.stringify(document), true));
  assert.equal(updates(), 0);
  assert.equal(secrets.size, 1);
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
test('failed metadata write restores existing secrets and removes newly imported secrets', async () => {
  const secrets = new Map([['remotehub:sftp://user@example.test:22', 'original']]);
  const store = new ConnectionStore({ get: () => [], update: async () => { throw new Error('storage failure'); } }, {
    get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key),
  });
  const json = JSON.stringify({ format: 'remote-hub', version: 1, connections: [config, { ...config, label: 'new', host: 'new.test' }] });
  await assert.rejects(store.importConnections(json, true), /storage failure/);
  assert.deepEqual([...secrets], [['remotehub:sftp://user@example.test:22', 'original']]);
  assert.deepEqual(store.getSavedConnections(), []);
});
