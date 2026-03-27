import * as vscode from 'vscode';
import * as path from 'path';

export interface ConnectionConfig {
  label: string;
  protocol: 'ssh' | 'sftp' | 'ftp' | 'ftps';
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'agent';
  password?: string;
  privateKeyPath?: string;
  remotePath: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class ConnectionManager {
  private _client: any = null;
  private _status: ConnectionStatus = 'disconnected';
  private _config: ConnectionConfig | null = null;
  private _context: vscode.ExtensionContext;
  private _passwordCache = new Map<string, string>();
  private _operationQueue: Promise<void> = Promise.resolve();

  readonly onStatusChange = new vscode.EventEmitter<ConnectionStatus>();
  readonly onLog = new vscode.EventEmitter<string>();

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get config(): ConnectionConfig | null {
    return this._config;
  }

  get client(): any {
    return this._client;
  }

  getSavedConnections(): ConnectionConfig[] {
    return this._context.globalState.get<ConnectionConfig[]>('savedConnections', []);
  }

  async saveConnection(config: ConnectionConfig): Promise<void> {
    const saved = this.getSavedConnections();
    const idx = saved.findIndex((c) => c.label === config.label);
    const toSave = { ...config };
    delete toSave.password; // Never persist passwords
    if (idx >= 0) {
      saved[idx] = toSave;
    } else {
      saved.unshift(toSave);
    }
    await this._context.globalState.update('savedConnections', saved.slice(0, 10));
  }

  async deleteConnection(label: string): Promise<void> {
    const saved = this.getSavedConnections();
    const filtered = saved.filter(c => c.label !== label);
    await this._context.globalState.update('savedConnections', filtered);
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (this._client) {
      this._log('Switching server: disconnecting current connection...');
      this.disconnect();
    }

    const effectiveConfig: ConnectionConfig = { ...config };
    const cacheKey = this._makePasswordCacheKey(effectiveConfig);
    if (effectiveConfig.authType === 'password' && !effectiveConfig.password) {
      const cachedPassword = this._passwordCache.get(cacheKey);
      if (cachedPassword) {
        effectiveConfig.password = cachedPassword;
        this._log(`Using cached password for ${effectiveConfig.username}@${effectiveConfig.host}.`);
      }
    }
    if (effectiveConfig.authType === 'password' && !effectiveConfig.password) {
      throw new Error('Password is required for this saved connection.');
    }

    this._setStatus('connecting');
    this._config = effectiveConfig;
    this._log(`Connecting to ${effectiveConfig.host}:${effectiveConfig.port} via ${effectiveConfig.protocol.toUpperCase()}...`);

    try {
      if (this._isSshLikeProtocol(effectiveConfig.protocol)) {
        await this._connectSftp(effectiveConfig);
      } else {
        await this._connectFtp(effectiveConfig);
      }
      this._setStatus('connected');
      this._log(`✓ Connected successfully as ${effectiveConfig.username}`);
      await this.saveConnection(effectiveConfig);
      if (effectiveConfig.authType === 'password' && effectiveConfig.password) {
        this._passwordCache.set(cacheKey, effectiveConfig.password);
      }
    } catch (err: any) {
      this._setStatus('error');
      this._log(`✗ Connection failed: ${err.message}`);
      throw err;
    }
  }

  private async _connectSftp(config: ConnectionConfig): Promise<void> {
    // Dynamic import to avoid bundling issues in dev
    const { Client } = await import('ssh2');
    return new Promise((resolve, reject) => {
      const client = new Client();
      const connConfig: any = {
        host: config.host,
        port: config.port,
        username: config.username,
        keepaliveInterval: 10000,
        keepaliveCountMax: 6,
      };

      if (config.authType === 'password') {
        connConfig.password = config.password;
      } else if (config.authType === 'privateKey') {
        const fs = require('fs');
        const keyPath = config.privateKeyPath!.replace('~', require('os').homedir());
        connConfig.privateKey = fs.readFileSync(keyPath);
      } else {
        connConfig.agent = process.env.SSH_AUTH_SOCK;
      }

      client
        .on('ready', () => {
          this._client = client;
          resolve();
        })
        .on('error', reject)
        .connect(connConfig);
    });
  }

  private async _connectFtp(config: ConnectionConfig): Promise<void> {
    const { Client } = await import('basic-ftp');
    const client = new Client();
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      secure: config.protocol === 'ftps',
    });
    this._client = client;
  }

  /** List directory contents */
  async listDir(remotePath: string): Promise<RemoteEntry[]> {
    return this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise((resolve, reject) => {
          this._client.sftp((err: Error, sftp: any) => {
            if (err) return reject(err);
            sftp.readdir(remotePath, (err2: Error, list: any[]) => {
              if (err2) return reject(err2);
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
    });
  }

  /** Download a remote file to a buffer */
  async downloadFile(remotePath: string): Promise<Buffer> {
    return this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');
      const { Writable } = require('stream');
      const chunks: Buffer[] = [];

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise((resolve, reject) => {
          this._client.sftp((err: Error, sftp: any) => {
            if (err) return reject(err);
            const stream = sftp.createReadStream(remotePath);
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
          });
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
    });
  }

  /** Upload a buffer to a remote path */
  async uploadFile(remotePath: string, content: Buffer): Promise<void> {
    await this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');
      const { Readable } = require('stream');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise<void>((resolve, reject) => {
          this._client.sftp((err: Error, sftp: any) => {
            if (err) return reject(err);
            const stream = sftp.createWriteStream(remotePath);
            stream.on('close', resolve);
            stream.on('error', reject);
            stream.end(content);
          });
        });
      }

      const readable = Readable.from(content);
      await this._client.uploadFrom(readable, remotePath);
    });
  }

  async createDirectory(remotePath: string): Promise<void> {
    await this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise<void>((resolve, reject) => {
          this._client.sftp((err: Error, sftp: any) => {
            if (err) return reject(err);
            sftp.mkdir(remotePath, (mkdirErr: Error | undefined) => {
              if (mkdirErr) return reject(mkdirErr);
              resolve();
            });
          });
        });
      }

      await this._client.ensureDir(remotePath);
    });
  }

  async renamePath(oldPath: string, newPath: string): Promise<void> {
    await this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');

      if (this._isSshLikeProtocol(this._config?.protocol)) {
        return new Promise<void>((resolve, reject) => {
          this._client.sftp((err: Error, sftp: any) => {
            if (err) return reject(err);
            sftp.rename(oldPath, newPath, (renameErr: Error | undefined) => {
              if (renameErr) return reject(renameErr);
              resolve();
            });
          });
        });
      }

      await this._client.rename(oldPath, newPath);
    });
  }

  async deletePath(remotePath: string, isDirectory: boolean): Promise<void> {
    await this._enqueue(async () => {
      if (!this._client) throw new Error('Not connected');

      if (this._config?.protocol === 'sftp') {
        return new Promise<void>((resolve, reject) => {
          this._client.sftp((err: Error, sftp: any) => {
            if (err) return reject(err);
            if (!isDirectory) {
              sftp.unlink(remotePath, (unlinkErr: Error | undefined) => {
                if (unlinkErr) return reject(unlinkErr);
                resolve();
              });
              return;
            }
            this._deleteSftpDirectoryRecursive(sftp, remotePath)
              .then(resolve)
              .catch(reject);
          });
        });
      }

      if (isDirectory) {
        await this._client.removeDir(remotePath);
      } else {
        await this._client.remove(remotePath);
      }
    });
  }

  disconnect(): void {
    try {
      if (this._isSshLikeProtocol(this._config?.protocol)) {
        this._client?.end();
      } else {
        this._client?.close();
      }
    } catch (_) {}
    if (this._config?.authType === 'password') {
      const key = this._makePasswordCacheKey(this._config);
      this._passwordCache.delete(key);
    }
    this._client = null;
    this._config = null;
    this._setStatus('disconnected');
    this._log('Disconnected.');
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

  private _makePasswordCacheKey(config: ConnectionConfig): string {
    return [
      config.label,
      config.protocol,
      config.host,
      config.port,
      config.username,
    ].join('|');
  }

  private _enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this._operationQueue.then(
      () => this._runWithReconnect(operation),
      () => this._runWithReconnect(operation)
    );
    this._operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async _runWithReconnect<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err: any) {
      if (!this._isReconnectableError(err)) {
        throw err;
      }

      const reconnected = await this._reconnect();
      if (!reconnected) {
        throw err;
      }

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

  private async _reconnect(): Promise<boolean> {
    if (!this._config) {
      return false;
    }

    const cfg: ConnectionConfig = { ...this._config };
    const cacheKey = this._makePasswordCacheKey(cfg);
    if (cfg.authType === 'password' && !cfg.password) {
      const cachedPassword = this._passwordCache.get(cacheKey);
      if (cachedPassword) {
        cfg.password = cachedPassword;
      }
    }
    if (cfg.authType === 'password' && !cfg.password) {
      return false;
    }

    this._log('Connection dropped. Reconnecting automatically...');
    try {
      try {
        if (this._isSshLikeProtocol(this._config?.protocol)) {
          this._client?.end();
        } else {
          this._client?.close();
        }
      } catch (_) {}
      this._client = null;

      this._setStatus('connecting');
      if (this._isSshLikeProtocol(cfg.protocol)) {
        await this._connectSftp(cfg);
      } else {
        await this._connectFtp(cfg);
      }
      this._config = cfg;
      this._setStatus('connected');
      this._log('✓ Reconnected.');
      return true;
    } catch (reconnectErr: any) {
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

export interface RemoteEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
}
