const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startFtpServer } = require('./helpers/ftp-server.cjs');
for (const protocol of ['ftp', 'ftps']) {
  test(`real ${protocol.toUpperCase()} transport transfers binary files and manages directories`, { timeout: 30000 }, async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-hub-tls-'));
    let server;
    try {
      let certificates;
      if (protocol === 'ftps') {
        certificates = await require('selfsigned').generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, algorithm: 'sha256', extensions: [
          { name: 'basicConstraints', cA: true },
          { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
          { name: 'extKeyUsage', serverAuth: true },
          { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] },
        ] });
        fs.writeFileSync(path.join(temporary, 'ca.pem'), certificates.cert);
      }
      server = await startFtpServer(certificates);
      const child = spawn(process.execPath, [path.join(__dirname, 'helpers/ftp-client.cjs'), protocol, String(server.port)], {
        env: { ...process.env, ...(certificates ? { NODE_EXTRA_CA_CERTS: path.join(temporary, 'ca.pem') } : {}) }, windowsHide: true,
      });
      let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
      const timer = setTimeout(() => child.kill(), 20000);
      const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
      clearTimeout(timer); assert.equal(code, 0, output);
      assert.equal(server.entries.has('/folder'), false);
    } finally {
      if (server) await server.close();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
}
