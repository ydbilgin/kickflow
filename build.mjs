import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  sourcemap: 'inline',
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/content/bootstrap.ts'], outfile: 'dist/content.js' });
await build({ ...common, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js' });
