import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'workspace-source', setup(build) { build.onResolve({ filter: /^@typenotes\// }, async args => ({ path: fileURLToPath(import.meta.resolve(args.path)) })); } }] });
