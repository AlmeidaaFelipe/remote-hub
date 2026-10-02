import * as vscode from 'vscode';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { HostKeyVerifier } from './HostKeyVerifier';
import { remoteUri } from './RemoteUri';
import { SshConfigParser } from './SshConfigParser';

import { ConnectionConfig, ConnectionStatus, RemoteEntry } from './ConnectionTypes';
import { ConnectionStore } from './ConnectionStore';
import { SerialQueue } from './SerialQueue';
export { ConnectionConfig, ConnectionStatus, RemoteEntry } from './ConnectionTypes';

export class ConnectionManager {
  private _sessionId = randomUUID();
  private readonly _connectionQueue = new SerialQueue();
  private _pendingClient: any = null;
  private _client: any = null;
  private _sftp: any = null;
  private _status: ConnectionStatus = 'disconnected';
  private _config: ConnectionConfig | null = null;
  private readonly _hostKeys: HostKeyVerifier;
  private readonly _store: ConnectionStore;
  private readonly _operationQueue = new SerialQueue();

  readonly onStatusChange = new vscode.EventEmitter<ConnectionStatus>();
  readonly onLog = new vscode.EventEmitter<string>();

  constructor(context: vscode.ExtensionContext) {
    this._hostKeys = new HostKeyVerifier(context.globalState);
    this._store = new ConnectionStore(context.globalState, context.secrets);
  }

  get sessionId(): string { return this._sessionId; }

  assertSession(sessionId: string): void {
    if (sessionId !== this._sessionId) throw new Error('Connection changed. Reopen the file on the current server.');
  }

  uri(remotePath: string): vscode.Uri { return remoteUri(remotePath, this.sessionId); }

  get status(): ConnectionStatus {
    return this._status;
  }

  get config(): ConnectionConfig | null {
    return this._config;
  }

  get client(): any {
    return this._client;
  }

  async forgetSshHostKey(): Promise<void> { await this._hostKeys.forget(); }

  getSavedConnections(): ConnectionConfig[] {
    return this._store.getSavedConnections();
  }

  async saveConnection(config: ConnectionConfig): Promise<void> {
    await this._store.saveConnection(config);
  }

  async deleteConnection(label: string): Promise<void> {
    await this._store.deleteConnection(label);
  }

  async getStoredPassword(config: ConnectionConfig): Promise<string | undefined> {
    return this._store.getStoredPassword(config);
  }

  async connect(config: ConnectionConfig): Promise<void> {
    this.disconnect();
    const sessionId = this.sessionId;
    return this._connectionQueue.enqueue(() => this._connect(config, sessionId));
  }

  private async _connect(config: ConnectionConfig, sessionId: string): Promise<void> {
    this.assertSession(sessionId);
    const effectiveConfig: ConnectionConfig = { ...config };

    if (this._isSshLikeProtocol(effectiveConfig.protocol)) {
      try {
        const sshResolved = SshConfigParser.resolve(effectiveConfig.host);
        if (sshResolved) {
          if (sshResolved.HostName) effectiveConfig.host = sshResolved.HostName;
          if (sshResolved.User && !effectiveConfig.username) effectiveConfig.username = sshResolved.User;
          // Only override default port
          if (sshResolved.Port && effectiveConfig.port === 22) effectiveConfig.port = sshResolved.Port;
          if (sshResolved.IdentityFile && sshResolved.IdentityFile.length > 0 && (!effectiveConfig.privateKeyPath || effectiveConfig.privateKeyPath === '~/.ssh/id_rsa')) {
            effectiveConfig.privateKeyPath = sshResolved.IdentityFile[0];
            if (effectiveConfig.authType === 'password' && !effectiveConfig.password) {
              effectiveConfig.authType = 'privateKey';
            }
          }
        }
      } catch (e: any) {
        this._log(`⚠️ Failed to read ~/.ssh/config: ${e.message || e}`);
      }
    }

    // Try to retrieve password from SecretStorage if not provided
    if (effectiveConfig.authType === 'password' && !effectiveConfig.password) {
      const storedPassword = await this.getStoredPassword(effectiveConfig);
      if (storedPassword) {
        effectiveConfig.password = storedPassword;
        effectiveConfig.savePassword = true;
        this._log(`Using saved password for ${effectiveConfig.username}@${effectiveConfig.host}.`);
      }
    }
    if (effectiveConfig.authType === 'password' && !effectiveConfig.password) {
      throw new Error('Password is required for this saved connection.');
    }

    this.assertSession(sessionId);
    this._setStatus('connecting');
    this._config = effectiveConfig;
    this._log(`Connecting to ${effectiveConfig.host}:${effectiveConfig.port} via ${effectiveConfig.protocol.toUpperCase()}...`);

    try {
      if (this._isSshLikeProtocol(effectiveConfig.protocol)) {
        await this._connectSftp(effectiveConfig, sessionId);
      } else {
        await this._connectFtp(effectiveConfig, sessionId);
      }
      this.assertSession(sessionId);
      this._setStatus('connected');
      this._log(`✓ Connected successfully as ${effectiveConfig.username}`);
      await this.saveConnection(effectiveConfig);
    } catch (err: any) {
      if (sessionId !== this.sessionId) throw err;
      try { this._pendingClient?.end?.(); this._pendingClient?.close?.(); } catch { /* Failed transports may already be closed. */ }
      this._pendingClient = null;
      this._setStatus('error');
      this._log(`✗ Connection failed: ${err.message}`);
      throw err;
    }
  }

  private async _connectSftp(config: ConnectionConfig, sessionId = this.sessionId): Promise<void> {
    // Dynamic import to avoid bundling issues in dev
    const { Client } = await import('ssh2');
    const client = new Client();
    const connConfig: any = {
      host: config.host,
      port: config.port,
      username: config.username,
      keepaliveInterval: 10000,
      keepaliveCountMax: 6,
      hostVerifier: (key: Buffer, callback: (verified: boolean) => void) => {
        void this._hostKeys.verify(config.host, config.port, key).then(
          trusted => callback(trusted && sessionId === this.sessionId),
          () => callback(false)
        );
      },
    };

    if (config.authType === 'password') {
      connConfig.password = config.password;
    } else if (config.authType === 'privateKey') {
      const fs = require('fs');
      const keyPath = config.privateKeyPath!.replace('~', require('os').homedir());
      const keyData = fs.readFileSync(keyPath);

      // Check if the key is encrypted and ask for passphrase
      const keyStr = keyData.toString('utf8');
      if (keyStr.includes('ENCRYPTED')) {
        const vscode = require('vscode');
        const passphrase = await vscode.window.showInputBox({
          title: 'SSH Key Passphrase',
          prompt: `Enter passphrase for ${config.privateKeyPath}`,
          password: true,
        });
        if (!passphrase) {
          throw new Error('Passphrase is required for this encrypted key.');
        }
        connConfig.privateKey = keyData;
        connConfig.passphrase = passphrase;
      } else {
        connConfig.privateKey = keyData;
      }
    } else {
      connConfig.agent = process.platform === 'win32'
        ? '\\\\.\\pipe\\openssh-ssh-agent'
        : process.env.SSH_AUTH_SOCK;
    }

    this.assertSession(sessionId);
    this._pendingClient = client;
    return new Promise<void>((resolve, reject) => {
      client
        .on('ready', () => {
          client.sftp((err: any, sftp: any) => {
            if (err) {
              client.end();
              return reject(err);
            }
            if (sessionId !== this.sessionId) { client.end(); return reject(new Error('Connection changed.')); }
            this._pendingClient = null;
            this._client = client;
            this._sftp = sftp;
            resolve();
          });
        })
        .on('error', reject)
        .on('close', () => reject(new Error('Connection closed')))
        .connect(connConfig);
    });
  }

  private async _connectFtp(config: ConnectionConfig, sessionId = this.sessionId): Promise<void> {
    const { Client } = await import('basic-ftp');
    this.assertSession(sessionId);
    const client = new Client();
    this._pendingClient = client;
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.protocol === 'ftps',
    });
    if (sessionId !== this.sessionId) { client.close(); throw new Error('Connection changed.'); }
    this._pendingClient = null;
    this._client = client;
  }

  /** List directory contents */
  async listDir(remotePath: string, sessionId = this.sessionId): Promise<RemoteEntry[]> {
    return this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise((resolve, reject) => {
          this._sftp.readdir(remotePath, (err: Error, list: any[]) => {
            if (err) return reject(err);
            resolve(
              list.map((f) => ({
                name: f.filename,
                fullPath: path.posix.join(remotePath, f.filename),
                isDirectory: f.attrs.isDirectory(),
                size: f.attrs.size,
                modifiedAt: new Date(f.attrs.mtime * 1000),
              }))
            );
          });
        });
      }

      const list = await this._client.list(remotePath);
      return list.map((f: any) => ({
        name: f.name,
        fullPath: path.posix.join(remotePath, f.name),
        isDirectory: f.isDirectory,
        size: f.size,
        modifiedAt: f.modifiedAt,
      }));
    }, sessionId);
  }

  async statPath(remotePath: string, sessionId = this.sessionId): Promise<RemoteEntry> {
    return this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');
      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise<RemoteEntry>((resolve, reject) => {
          this._sftp.stat(remotePath, (err: Error | undefined, attrs: any) => {
            if (err) return reject(err);
            resolve({ name: path.posix.basename(remotePath), fullPath: remotePath, isDirectory: attrs.isDirectory(), size: attrs.size, modifiedAt: new Date(attrs.mtime * 1000) });
          });
        });
      }
      if (remotePath === '/') {
        await this._client.list('/');
        return { name: '/', fullPath: '/', isDirectory: true, size: 0, modifiedAt: new Date(0) };
      }
      const entries = await this._client.list(path.posix.dirname(remotePath));
      const entry = entries.find((entry: any) => entry.name === path.posix.basename(remotePath));
      if (!entry) throw Object.assign(new Error('File not found'), { code: 2 });
      return { name: entry.name, fullPath: remotePath, isDirectory: entry.isDirectory, size: entry.size, modifiedAt: entry.modifiedAt || new Date(0) };
    }, sessionId);
  }

  /** Execute a shell command (SSH only)  */
  async execCommand(command: string, allowedExitCodes: number[] = [0], sessionId = this.sessionId): Promise<string> {
    return this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');
      if (!this._isSshLikeProtocol(this._config?.protocol)) {
        throw new Error('Command execution is only supported on SSH/SFTP connections');
      }

      return new Promise<string>((resolve, reject) => {
        this._client.exec(command, (err: Error, stream: any) => {
          if (err) return reject(err);
          let stdout = '';
          let stderr = '';
          stream.on('data', (data: Buffer) => {
            stdout += data.toString('utf8');
          });
          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString('utf8');
          });
          stream.on('error', reject);
          stream.on('close', (code: number) => {
            if (!allowedExitCodes.includes(code)) {
              return reject(new Error(`Command failed (code ${code}): ${stderr}`));
            }
            resolve(stdout);
          });
        });
      });
    }, sessionId);
  }

  /** Download a remote file to a buffer */
  async downloadFile(remotePath: string, sessionId = this.sessionId): Promise<Buffer> {
    return this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');
      const { Writable } = require('stream');
      const chunks: Buffer[] = [];

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise((resolve, reject) => {
          const stream = this._sftp.createReadStream(remotePath);
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      }

      const writable = new Writable({
        write(chunk: Buffer, _: any, cb: () => void) {
          chunks.push(chunk);
          cb();
        },
      });
      await this._client.downloadTo(writable, remotePath);
      return Buffer.concat(chunks);
    }, sessionId);
  }

  /** Upload a buffer to a remote path */
  async uploadFile(remotePath: string, content: Buffer, sessionId = this.sessionId): Promise<void> {
    await this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');
      const { Readable } = require('stream');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise<void>((resolve, reject) => {
          const stream = this._sftp.createWriteStream(remotePath);
          stream.on('close', resolve);
          stream.on('error', reject);
          stream.end(content);
        });
      }

      const readable = Readable.from(content);
      await this._client.uploadFrom(readable, remotePath);
    }, sessionId);
  }

  async createDirectory(remotePath: string, sessionId = this.sessionId): Promise<void> {
    await this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise<void>((resolve, reject) => {
          this._sftp.mkdir(remotePath, (err: Error | undefined) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }

      const client = this._client;
      const previous = await client.pwd();
      try { await client.ensureDir(remotePath); } finally { await client.cd(previous); }
    }, sessionId);
  }

  async renamePath(oldPath: string, newPath: string, sessionId = this.sessionId): Promise<void> {
    await this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise<void>((resolve, reject) => {
          this._sftp.rename(oldPath, newPath, (err: Error | undefined) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }

      await this._client.rename(oldPath, newPath);
    }, sessionId);
  }

  async deletePath(remotePath: string, isDirectory: boolean, sessionId = this.sessionId): Promise<void> {
    await this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise<void>((resolve, reject) => {
          if (!isDirectory) {
            this._sftp.unlink(remotePath, (err: Error | undefined) => {
              if (err) return reject(err);
              resolve();
            });
            return;
          }
          this._deleteSftpDirectoryRecursive(this._sftp, remotePath)
            .then(resolve)
            .catch(reject);
        });
      }

      if (isDirectory) {
        await this._client.removeDir(remotePath);
      } else {
        await this._client.remove(remotePath);
      }
    }, sessionId);
  }

  disconnect(): void {
    this._sessionId = randomUUID();
    try { this._pendingClient?.end?.(); this._pendingClient?.close?.(); } catch { /* Pending transports may already be closed. */ }
    this._pendingClient = null;
    try {
      if (this._isSshLikeProtocol(this._config?.protocol)) {
        this._client?.end();
      } else {
        this._client?.close();
      }
    } catch { /* Closing an already disconnected transport is harmless. */ }
    this._client = null;
    this._sftp = null;
    this._config = null;
    this._setStatus('disconnected');
    this._log('Disconnected.');
  }

  dispose(): void {
    this.disconnect();
    this.onStatusChange.dispose();
    this.onLog.dispose();
  }

  private _setStatus(status: ConnectionStatus) {
    this._status = status;
    this.onStatusChange.fire(status);
  }

  private _log(msg: string) {
    this.onLog.fire(`[${new Date().toLocaleTimeString()}] ${msg}`);
  }

  private _isSshLikeProtocol(
    protocol: ConnectionConfig['protocol'] | undefined
  ): boolean {
    return protocol === 'ssh' || protocol === 'sftp';
  }

  private _enqueue<T>(operation: () => Promise<T>, sessionId = this.sessionId): Promise<T> {
    return this._operationQueue.enqueue(async () => {
      this.assertSession(sessionId);
      const result = await this._runWithReconnect(operation, sessionId);
      this.assertSession(sessionId);
      return result;
    });
  }

  private async _runWithReconnect<T>(operation: () => Promise<T>, sessionId: string): Promise<T> {
    try {
      return await operation();
    } catch (err: any) {
      this.assertSession(sessionId);
      if (!this._isReconnectableError(err)) throw err;
      const reconnected = await this._reconnect(sessionId);
      this.assertSession(sessionId);
      if (!reconnected) throw err;
      return operation();
    }
  }

  private _isReconnectableError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase();
    return (
      msg.includes('client is closed') ||
      msg.includes('fin packet') ||
      msg.includes('not connected') ||
      msg.includes('econnreset') ||
      msg.includes('connection lost') ||
      msg.includes('connection closed')
    );
  }

  private async _reconnect(sessionId = this.sessionId): Promise<boolean> {
    if (!this._config) {
      return false;
    }

    const cfg: ConnectionConfig = { ...this._config };
    if (cfg.authType === 'password' && !cfg.password) {
      const storedPassword = await this.getStoredPassword(cfg);
      if (storedPassword) {
        cfg.password = storedPassword;
      }
    }
    if (cfg.authType === 'password' && !cfg.password) {
      return false;
    }

    this.assertSession(sessionId);
    this._log('Connection dropped. Reconnecting automatically...');
    try {
      try {
        if (this._isSshLikeProtocol(this._config?.protocol)) {
          this._client?.end();
        } else {
          this._client?.close();
        }
      } catch { /* Closing an already disconnected transport is harmless. */ }
      this._client = null;
      this._sftp = null;

      this._setStatus('connecting');
      if (this._isSshLikeProtocol(cfg.protocol)) {
        await this._connectSftp(cfg, sessionId);
      } else {
        await this._connectFtp(cfg, sessionId);
      }
      this.assertSession(sessionId);
      this._config = cfg;
      this._setStatus('connected');
      this._log('✓ Reconnected.');
      return true;
    } catch (reconnectErr: any) {
      if (sessionId !== this.sessionId) return false;
      this._setStatus('error');
      this._log(`✗ Reconnect failed: ${reconnectErr.message}`);
      return false;
    }
  }

  private async _deleteSftpDirectoryRecursive(sftp: any, dirPath: string): Promise<void> {
    const list = await new Promise<any[]>((resolve, reject) => {
      sftp.readdir(dirPath, (err: Error | undefined, entries: any[]) => {
        if (err) return reject(err);
        resolve(entries || []);
      });
    });

    for (const entry of list) {
      if (entry.filename === '.' || entry.filename === '..' || entry.filename.includes('/')) continue;
      const childPath = path.posix.join(dirPath, entry.filename);
      if (entry.attrs?.isDirectory?.()) {
        await this._deleteSftpDirectoryRecursive(sftp, childPath);
      } else {
        await new Promise<void>((resolve, reject) => {
          sftp.unlink(childPath, (err: Error | undefined) => {
            if (err) return reject(err);
            resolve();
          });
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      sftp.rmdir(dirPath, (err: Error | undefined) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}
