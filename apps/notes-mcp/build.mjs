import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
const options = {bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'workspace-source', setup(build) { build.onResolve({ filter: /^@typenotes\// }, async args => ({ path: fileURLToPath(import.meta.resolve(args.path)) })); } }] };
await Promise.all([
  build({...options,entryPoints:['src/main.ts'],outfile:'dist/main.mjs'}),
  build({...options,entryPoints:['src/brain-main.ts'],outfile:'dist/brain.mjs'}),
]);
await Promise.all([
  copyFile('src/voice.html','dist/voice.html'),
  copyFile('src/voice-client.js','dist/voice-client.js'),
]);
