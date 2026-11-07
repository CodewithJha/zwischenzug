// Renders build/icon.svg to build/icon.png (1024 px) with Electron, then builds build/icon.icns
// with macOS sips + iconutil. Run: npm run icon (macOS only).
import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '..', 'build');
const svg = readFileSync(path.join(dir, 'icon.svg'), 'utf8');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<canvas width="1024" height="1024"></canvas>');
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.querySelector('canvas');
      c.getContext('2d').drawImage(img, 0, 0, 1024, 1024);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
  })`);
  const png = path.join(dir, 'icon.png');
  writeFileSync(png, Buffer.from(dataUrl.split(',')[1], 'base64'));

  const iconset = path.join(dir, 'icon.iconset');
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [
      [1, ''],
      [2, '@2x'],
    ]) {
      const out = path.join(iconset, `icon_${size}x${size}${suffix}.png`);
      execFileSync('sips', ['-z', String(size * scale), String(size * scale), png, '--out', out], {
        stdio: 'ignore',
      });
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(dir, 'icon.icns')]);
  rmSync(iconset, { recursive: true, force: true });
  app.quit();
});
