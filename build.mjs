import { build } from 'esbuild';

await build({
  entryPoints: ['src/content/bootstrap.ts'],
  outfile: 'dist/content.js',
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  sourcemap: 'inline',
  logLevel: 'info',
});
