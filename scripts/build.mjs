// Builds main, preload and renderer bundles into dist/.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'es2023' };

await rm('dist', { recursive: true, force: true });

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main/index.js',
    platform: 'node',
    format: 'cjs',
    // Native SDK (koffi + dylibs) and electron-log stay in node_modules.
    packages: 'external',
  }),
  build({
    ...common,
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dist/preload/index.js',
    platform: 'node',
    format: 'cjs',
    // Sandboxed preloads can only require('electron'); everything else is inlined.
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/renderer/main.ts'],
    outfile: 'dist/renderer/main.js',
    platform: 'browser',
    format: 'iife',
  }),
]);

await mkdir('dist/renderer', { recursive: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');
await cp('src/renderer/styles.css', 'dist/renderer/styles.css');
