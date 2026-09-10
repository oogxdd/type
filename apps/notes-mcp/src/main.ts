import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NotesRepository } from './repository';
import { createServer } from './server';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--notes-root') {
  process.stderr.write('Usage: node main.mjs --notes-root /absolute/path/to/notes\n');
  process.exitCode = 1;
} else {
  try {
    const server = createServer(await NotesRepository.create(args[1]));
    await server.connect(new StdioServerTransport());
  } catch {
    process.stderr.write('Cannot start notes MCP. Check the notes-root directory and permissions.\n');
    process.exitCode = 1;
  }
}
