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
