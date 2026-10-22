import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  sourcemap: 'inline',
  logLevel: 'info',
};

// Diagnostics reporter for the optional local Extension Helper; loaded before the content script and in the popup.
await build({ ...common, entryPoints: ['src/extension-helper.mjs'], outfile: 'dist/extension-helper.js' });
await build({ ...common, entryPoints: ['src/content/bootstrap.ts'], outfile: 'dist/content.js' });
await build({ ...common, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js' });
await build({
  ...common,
  target: ['chrome111'],
  entryPoints: ['src/mainworld/react-key-stamper.ts'],
  outfile: 'dist/mainworld.js',
});
await build({
  ...common,
  target: ['chrome111'],
  entryPoints: ['src/mainworld/native-chat-entry.ts'],
  outfile: 'dist/native-chat.js',
});
