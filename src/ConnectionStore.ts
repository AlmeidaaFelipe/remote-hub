import type * as vscode from 'vscode';
import { ConnectionConfig } from './ConnectionTypes';

/** Owns saved connection metadata and credentials. Storage keys remain compatible. */
export class ConnectionStore {
  constructor(
    private readonly _state: vscode.Memento,
    private readonly _secrets: vscode.SecretStorage
  ) {}

  getSavedConnections(): ConnectionConfig[] {
    return this._state.get<ConnectionConfig[]>('savedConnections', []);
  }

  async exportConnections(includePasswords = false): Promise<string> {
    const connections = await Promise.all(this.getSavedConnections().map(async connection => {
      const portable = this._portableConnection(connection);
      if (includePasswords && connection.authType === 'password' && connection.savePassword) {
        const password = await this.getStoredPassword(connection);
        if (password) { portable.password = password; portable.savePassword = true; }
      }
      return portable;
    }));
    return JSON.stringify({
      format: 'remote-hub', version: 1,
      connections,
    }, null, 2) + '\n';
  }

  async importConnections(json: string, includePasswords = false): Promise<{ imported: number; skipped: number }> {
    const document = JSON.parse(json.replace(/^\uFEFF/, ''));
    if (!document || document.format !== 'remote-hub' || document.version !== 1 || !Array.isArray(document.connections)) {
      throw new Error('Expected a Remote Hub connections file (version 1).');
    }
    // Validate the complete document before changing saved metadata.
    const incoming = document.connections.map((value: unknown) => {
      const portable = this._portableConnection(value);
      const password = (value as ConnectionConfig).password;
      if (password !== undefined && typeof password !== 'string') throw new Error('Invalid connection password.');
      if (includePasswords && portable.authType === 'password' && password) portable.password = password;
      return portable;
    });
    const saved = [...this.getSavedConnections()];
    const labels = new Set(saved.map(connection => connection.label));
    let imported = 0;
    let skipped = 0;
    const credentials = new Map<string, string>();
    for (const connection of incoming) {
      if (labels.has(connection.label)) { skipped++; continue; }
      labels.add(connection.label);
      if (connection.password) {
        credentials.set(this._makeSecretKey(connection), connection.password);
        connection.savePassword = true;
        delete connection.password;
      }
      saved.push(connection);
      imported++;
    }
    if (saved.length > 10) throw new Error('Import exceeds the limit of 10 saved connections.');
    const previous = new Map<string, string | undefined>();
    try {
      for (const [key, password] of credentials) {
        previous.set(key, await this._secrets.get(key));
        await this._secrets.store(key, password);
      }
      if (imported) await this._state.update('savedConnections', saved);
    } catch (error) {
      for (const [key, password] of previous) {
        if (password === undefined) await this._secrets.delete(key);
        else await this._secrets.store(key, password);
      }
      throw error;
    }
    return { imported, skipped };
  }

  private _portableConnection(value: unknown): ConnectionConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid connection.');
    const connection = value as ConnectionConfig;
    for (const field of ['label', 'host', 'username', 'remotePath'] as const) {
      if (typeof connection[field] !== 'string' || !connection[field].trim()) throw new Error(`Invalid connection ${field}.`);
    }
    if (!['ssh', 'sftp', 'ftp', 'ftps'].includes(connection.protocol) ||
        !['password', 'privateKey', 'agent'].includes(connection.authType) ||
        !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 ||
        (['ftp', 'ftps'].includes(connection.protocol) && connection.authType !== 'password') ||
        (connection.privateKeyPath !== undefined && typeof connection.privateKeyPath !== 'string') ||
        (connection.authType === 'privateKey' && !connection.privateKeyPath?.trim())) {
      throw new Error('Invalid connection protocol, authentication or port.');
    }
    return {
      label: connection.label, protocol: connection.protocol, host: connection.host,
      port: connection.port, username: connection.username, authType: connection.authType,
      remotePath: connection.remotePath, savePassword: false,
      ...(connection.privateKeyPath ? { privateKeyPath: connection.privateKeyPath } : {}),
    };
  }

  async saveConnection(config: ConnectionConfig): Promise<void> {
    const saved = this.getSavedConnections();
    const index = saved.findIndex(connection => connection.label === config.label);
    const toSave = { ...config };
    delete toSave.password;
    if (index >= 0) {
      saved[index] = toSave;
    } else {
      saved.unshift(toSave);
    }
    await this._state.update('savedConnections', saved.slice(0, 10));
    if (config.savePassword && config.authType === 'password' && config.password) {
      await this._secrets.store(this._makeSecretKey(config), config.password);
    }
  }

  async deleteConnection(label: string): Promise<void> {
    const saved = this.getSavedConnections();
    const connection = saved.find(connection => connection.label === label);
    if (connection) {
      await this._secrets.delete(this._makeSecretKey(connection));
    }
    await this._state.update('savedConnections', saved.filter(connection => connection.label !== label));
  }

  async getStoredPassword(config: ConnectionConfig): Promise<string | undefined> {
    return this._secrets.get(this._makeSecretKey(config));
  }

  private _makeSecretKey(config: ConnectionConfig): string {
    return `remotehub:${config.protocol}://${config.username}@${config.host}:${config.port}`;
  }
}
