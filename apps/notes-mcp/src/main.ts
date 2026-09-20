import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NotesRepository } from './repository';
import { createServer } from './server';

const args = process.argv.slice(2);
const layout = args[3] ?? 'auto';
if (![2,4].includes(args.length) || args[0] !== '--notes-root' || (args.length === 4 && (args[2] !== '--layout' || !['auto','legacy','system'].includes(layout)))) {
  process.stderr.write('Usage: node main.mjs --notes-root /absolute/path/to/notes [--layout auto|legacy|system]\n');
  process.exitCode = 1;
} else {
  try {
    const server = createServer(await NotesRepository.create(args[1], layout as 'auto' | 'legacy' | 'system'));
    await server.connect(new StdioServerTransport());
  } catch {
    process.stderr.write('Cannot start notes MCP. Check notes-root, permissions and layout. Mixed layouts require explicit --layout legacy or system; no migration is performed.\n');
    process.exitCode = 1;
  }
}
