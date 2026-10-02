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
  savePassword?: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface RemoteEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
}
