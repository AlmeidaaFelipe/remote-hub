const net = require('node:net');
const tls = require('node:tls');
const path = require('node:path').posix;
const { once } = require('node:events');

/** Small loopback FTP fixture, supporting explicit TLS and passive transfers. */
exports.startFtpServer = async function(certificates) {
  const entries = new Map([['/', null], ['/original.txt', Buffer.from('original')]]);
  const sockets = new Set(), passiveServers = new Set();
  const secureContext = certificates && tls.createSecureContext({ key: certificates.private, cert: certificates.cert });
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    let control = socket, cwd = '/', encrypted = false, pending = '', renameFrom;
    let dataServer, dataSocket, waitForData;
    const reply = text => control.write(text + '\r\n');
    const fullPath = name => path.resolve(cwd, name || '.');
    const attach = stream => stream.on('data', chunk => {
      pending += chunk.toString();
      while (pending.includes('\r\n')) {
        const index = pending.indexOf('\r\n'); const line = pending.slice(0, index); pending = pending.slice(index + 2);
        void command(line).catch(error => reply('550 ' + error.message));
      }
    });
    async function passive() {
      if (dataServer) { dataServer.close(); passiveServers.delete(dataServer); }
      dataSocket = undefined;
      waitForData = new Promise(resolve => {
        const ready = stream => { dataSocket = stream; sockets.add(stream); stream.on('error', () => {}); stream.on('close', () => sockets.delete(stream)); resolve(stream); };
        dataServer = encrypted ? tls.createServer({ key: certificates.private, cert: certificates.cert }, ready) : net.createServer(ready);
      });
      passiveServers.add(dataServer);
      dataServer.listen(0, '127.0.0.1'); await once(dataServer, 'listening');
      return dataServer.address().port;
    }
    async function sendData(content) {
      reply('150 Opening data connection');
      const stream = dataSocket || await waitForData;
      const closed = once(stream, 'close'); stream.end(content); await closed; reply('226 Transfer complete');
    }
    async function command(line) {
      const separator = line.indexOf(' ');
      const name = (separator < 0 ? line : line.slice(0, separator)).toUpperCase();
      const argument = separator < 0 ? '' : line.slice(separator + 1);
      switch (name) {
        case 'AUTH':
          if (!secureContext) return reply('502 TLS unavailable');
          reply('234 Start TLS'); control.removeAllListeners('data');
          control = new tls.TLSSocket(socket, { isServer: true, secureContext });
          control.on('error', () => {}); encrypted = true; attach(control); return;
        case 'FEAT': return reply('211-Features\r\n MLST type*;size*;modify*;\r\n UTF8\r\n EPSV\r\n211 End');
        case 'USER': return reply('331 Password required');
        case 'PASS': return reply(argument === 'secret' ? '230 Logged in' : '530 Bad password');
        case 'TYPE': case 'STRU': case 'OPTS': case 'PBSZ': case 'PROT': return reply('200 OK');
        case 'PWD': return reply(`257 "${cwd}"`);
        case 'CWD': if (entries.get(fullPath(argument)) !== null) return reply('550 Missing directory'); cwd = fullPath(argument); return reply('250 Changed');
        case 'CDUP': cwd = path.dirname(cwd); return reply('250 Changed');
        case 'MKD': entries.set(fullPath(argument), null); return reply('257 Created');
        case 'RMD': case 'DELE': entries.delete(fullPath(argument)); return reply('250 Removed');
        case 'RNFR': renameFrom = fullPath(argument); return reply('350 Destination required');
        case 'RNTO': entries.set(fullPath(argument), entries.get(renameFrom)); entries.delete(renameFrom); return reply('250 Renamed');
        case 'EPSV': return reply(`229 Entering Extended Passive Mode (|||${await passive()}|)`);
        case 'PASV': { const port = await passive(); return reply(`227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`); }
        case 'MLSD': case 'LIST': {
          const directory = fullPath(argument);
          const listing = [...entries].filter(([key]) => key !== directory && path.dirname(key) === directory).map(([key, value]) => `type=${value === null ? 'dir' : 'file'};size=${value?.length || 0};modify=20261002000000; ${path.basename(key)}\r\n`).join('');
          return sendData(Buffer.from(listing));
        }
        case 'RETR': { const content = entries.get(fullPath(argument)); if (!Buffer.isBuffer(content)) return reply('550 Missing file'); return sendData(content); }
        case 'STOR': {
          const destination = fullPath(argument); reply('150 Ready for upload');
          const stream = dataSocket || await waitForData; const chunks = [];
          stream.on('data', chunk => chunks.push(chunk)); await once(stream, 'end');
          entries.set(destination, Buffer.concat(chunks)); const closed = once(stream, 'close'); stream.end(); await closed; return reply('226 Uploaded');
        }
        case 'SIZE': { const content = entries.get(fullPath(argument)); return reply(Buffer.isBuffer(content) ? `213 ${content.length}` : '550 Missing'); }
        case 'MDTM': return reply('213 20261002000000');
        case 'QUIT': reply('221 Goodbye'); control.end(); return;
        default: return reply('502 Unsupported ' + name);
      }
    }
    attach(control); reply('220 Remote Hub test FTP');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { port: server.address().port, entries, close: async () => {
    for (const stream of sockets) stream.destroy();
    for (const passive of passiveServers) passive.close();
    await new Promise(resolve => server.close(resolve));
  } };
};
