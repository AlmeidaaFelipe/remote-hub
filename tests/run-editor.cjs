const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');
(async () => {
  const root = path.resolve(__dirname, '..');
  const profiles = path.join(root, '.vscode-test');
  fs.mkdirSync(profiles, { recursive: true });
  const installed = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe') : undefined;
  const executable = process.env.VSCODE_EXECUTABLE_PATH || (installed && !process.env.VSCODE_TEST_VERSION && fs.existsSync(installed) ? installed : await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION || '1.85.2'));
  // Launch the executable directly: Windows shell splitting breaks paths with spaces.
  const child = spawn(executable, [
    `--extensionDevelopmentPath=${root}`,
    `--extensionTestsPath=${path.join(root, 'tests/editor/suite.cjs')}`,
    `--user-data-dir=${path.join(profiles, 'editor-profile')}`,
    `--extensions-dir=${path.join(profiles, 'editor-extensions')}`,
    '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--no-sandbox',
  ], { shell: false, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  const timer = setTimeout(() => child.kill(), 120000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); }
  finally { clearTimeout(timer); fs.writeFileSync(path.join(profiles, 'editor.log'), output); }
  if (code !== 0) throw new Error(`Extension Host exited ${code}:\n${output.split('\n').slice(-45).join('\n')}`);
  if (!output.includes('Extension Host checks passed')) throw new Error('Editor suite did not finish; see .vscode-test/editor.log');
  console.log('Extension Host checks passed. Full log: .vscode-test/editor.log');
})().catch(error => { console.error(error); process.exitCode = 1; });
