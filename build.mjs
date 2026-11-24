import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  sourcemap: 'inline',
  logLevel: 'info',
};

// The shipped bundles carry no source map (2026-11-11). content.js was 2.79 MB, of which the
// inline map was ~1.97 MB; every Kick tab loaded and kept that text although a map is only read
// by DevTools. Debug build: KICKFLOW_SOURCEMAP=inline node build.mjs
const distSourcemap = process.env.KICKFLOW_SOURCEMAP === 'inline' ? 'inline' : false;
const dist = { ...common, sourcemap: distSourcemap };

await build({ ...dist, entryPoints: ['src/content/bootstrap.ts'], outfile: 'dist/content.js' });
await build({ ...dist, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js' });
await build({
  ...dist,
  target: ['chrome111'],
  entryPoints: ['src/mainworld/react-key-stamper.ts'],
  outfile: 'dist/mainworld.js',
});
await build({
  ...dist,
  target: ['chrome111'],
  entryPoints: ['src/mainworld/native-chat-entry.ts'],
  outfile: 'dist/native-chat.js',
});
