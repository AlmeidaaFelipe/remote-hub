const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const Module = require('node:module');
const vscode = { env: { language: 'en' } };
const load = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? vscode : load.call(this, name, ...args); };
const { SftpPanelViewProvider } = require('../out/SftpPanelViewProvider');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });
for (const language of ['en', 'pt-br']) {
  test(`webview in Chromium renders ${language}, connects and escapes saved data`, async () => {
    vscode.env.language = language;
    const provider = new SftpPanelViewProvider({}, {});
    const page = await browser.newPage({ viewport: { width: 380, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.evaluate(() => { window.messages = []; window.acquireVsCodeApi = () => ({ postMessage: message => window.messages.push(message) }); });
      await page.setContent(provider._getHtml());
      assert.equal(await page.locator('#f-proto option').count(), 4);
      await page.locator('#f-proto').selectOption('ftp');
      await page.locator('#f-host').fill('localhost');
      await page.locator('#f-user').fill('user');
      await page.locator('#f-pass').fill('password');
      await page.locator('button.btn').click();
      const config = await page.evaluate(() => window.messages.find(message => message.type === 'connect').config);
      assert.equal(config.host, 'localhost'); assert.equal(config.protocol, 'ftp'); assert.equal(config.port, 21);
      await page.evaluate(() => window.postMessage({ type: 'savedConnections', connections: [{ label: '<img src=x onerror="window.injected=true">', protocol: 'sftp', port: 22, username: 'user', host: 'host', authType: 'password', remotePath: '/' }] }, '*'));
      await page.locator('.saved-item').waitFor();
      assert.equal(await page.locator('#saved-list img').count(), 0);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      await page.locator('.saved-item').click();
      assert.equal(await page.locator('#f-host').inputValue(), 'host');
      await page.evaluate(() => window.postMessage({ type: 'statusChange', status: 'connected' }, '*'));
      await page.waitForFunction(() => document.getElementById('status-dot').classList.contains('connected'));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}
