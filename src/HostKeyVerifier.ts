import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { t } from './i18n';

/** Trust on first use, with explicit consent; changed keys are never accepted. */
export class HostKeyVerifier {
  constructor(private readonly _state: vscode.Memento) {}

  async verify(host: string, port: number, key: Buffer): Promise<boolean> {
    const identity = JSON.stringify([host.toLowerCase(), port]);
    const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
    const known = this._state.get<Record<string, string>>('trustedSshHostKeys', {});
    if (Object.prototype.hasOwnProperty.call(known, identity)) {
      if (known[identity] === fingerprint) return true;
      await vscode.window.showErrorMessage(t('ssh.keyChanged', host, port, fingerprint));
      return false;
    }
    const trust = t('ssh.trust');
    const answer = await vscode.window.showWarningMessage(t('ssh.trustPrompt', host, port, fingerprint), { modal: true }, trust);
    if (answer !== trust) return false;
    const current = this._state.get<Record<string, string>>('trustedSshHostKeys', {});
    if (current[identity] && current[identity] !== fingerprint) return false;
    await this._state.update('trustedSshHostKeys', { ...current, [identity]: fingerprint });
    return true;
  }

  async forget(): Promise<void> {
    const keys = this._state.get<Record<string, string>>('trustedSshHostKeys', {});
    const items = Object.keys(keys).map(identity => {
      const [host, port] = JSON.parse(identity) as [string, number];
      return { label: `${host}:${port}`, description: keys[identity], identity };
    });
    const selected = await vscode.window.showQuickPick(items, { title: t('ssh.forgetTitle') });
    if (!selected) return;
    const answer = await vscode.window.showWarningMessage(t('ssh.forgetPrompt', selected.label), { modal: true }, t('ssh.forget'));
    if (answer !== t('ssh.forget')) return;
    const current = this._state.get<Record<string, string>>('trustedSshHostKeys', {});
    delete current[selected.identity];
    await this._state.update('trustedSshHostKeys', current);
  }
}
