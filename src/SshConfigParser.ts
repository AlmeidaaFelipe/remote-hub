import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SshConfigEntry {
  Host: string[];
  HostName?: string;
  User?: string;
  Port?: number;
  IdentityFile?: string[];
}

export class SshConfigParser {
  static parse(): SshConfigEntry[] {
    const configPath = path.join(os.homedir(), '.ssh', 'config');
    if (!fs.existsSync(configPath)) {
      return [];
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const lines = content.split('\n');
    const entries: SshConfigEntry[] = [];
    let currentEntry: SshConfigEntry | null = null;

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;

      const sepMatch = line.match(/^([^=\s]+)[\s=]+(.*)$/);
      if (!sepMatch) continue;

      const key = sepMatch[1].toLowerCase();
      const value = sepMatch[2].replace(/^["']|["']$/g, '');

      if (key === 'host') {
        currentEntry = { Host: value.split(/\s+/) };
        entries.push(currentEntry);
      } else if (currentEntry) {
        if (key === 'hostname') {
          currentEntry.HostName = value;
        } else if (key === 'user') {
          currentEntry.User = value;
        } else if (key === 'port') {
          currentEntry.Port = parseInt(value, 10);
        } else if (key === 'identityfile') {
          currentEntry.IdentityFile = currentEntry.IdentityFile || [];
          currentEntry.IdentityFile.push(value);
        }
      }
    }

    return entries;
  }

  static resolve(hostAlias: string): Partial<SshConfigEntry> {
    const entries = this.parse();
    const merged: Partial<SshConfigEntry> = {};

    for (const entry of entries) {
      const isMatch = entry.Host.some(h => {
        if (h === hostAlias) return true;
        if (h.includes('*')) {
          const regex = new RegExp('^' + h.replace(/\*/g, '.*') + '$');
          return regex.test(hostAlias);
        }
        return false;
      });

      if (isMatch) {
        if (entry.HostName && !merged.HostName) merged.HostName = entry.HostName;
        if (entry.User && !merged.User) merged.User = entry.User;
        if (entry.Port && !merged.Port) merged.Port = entry.Port;
        if (entry.IdentityFile) {
          merged.IdentityFile = merged.IdentityFile || [];
          merged.IdentityFile.push(...entry.IdentityFile);
        }
      }
    }

    return merged;
  }
}
