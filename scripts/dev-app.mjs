// Runs the app in development under the name Zwischenzug instead of Electron. macOS takes the
// Dock and menu bar name from the bundle's Info.plist, which app.setName() cannot change, so on
// macOS this keeps a renamed copy of Electron.app in .scratch/ (an APFS clone, so it is cheap),
// re-signs it ad hoc, and launches the repo with it. Elsewhere it just runs electron.
// Run: npm run dev (npm run dev:raw skips this and uses plain Electron).
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const electronBin = createRequire(import.meta.url)('electron');

function devBundle() {
  const source = path.resolve(electronBin, '../../..');
  const app = path.join(root, '.scratch', 'Zwischenzug.app');
  const icon = path.join(root, 'build', 'icon.icns');
  const stampFile = `${app}.stamp`;
  const stamp = `${statSync(path.join(source, 'Contents', 'Info.plist')).mtimeMs}:${statSync(icon).mtimeMs}`;
  const binary = path.join(app, 'Contents', 'MacOS', 'Electron');
  if (existsSync(binary) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
    return binary;
  }

  rmSync(app, { recursive: true, force: true });
  execFileSync('cp', ['-cR', source, app]);
  copyFileSync(icon, path.join(app, 'Contents', 'Resources', 'zwischenzug.icns'));
  const plist = path.join(app, 'Contents', 'Info.plist');
  for (const [key, value] of [
    ['CFBundleName', 'Zwischenzug'],
    ['CFBundleDisplayName', 'Zwischenzug'],
    ['CFBundleIdentifier', 'dev.zwischenzug.app.dev'],
    ['CFBundleIconFile', 'zwischenzug.icns'],
  ]) {
    execFileSync('plutil', ['-replace', key, '-string', value, plist]);
  }
  // The edited Info.plist breaks Electron's signature; macOS needs a valid one for the camera.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
  writeFileSync(stampFile, stamp);
  return binary;
}

const bin = process.platform === 'darwin' ? devBundle() : electronBin;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(bin, [root, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
