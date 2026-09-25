import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NotesRepository } from './repository';
import { createBrainWithNotes, createBrainMcpServer, DEFAULT_BRAIN_MODEL } from './brain';
import { OpenAIApi } from './openai-api';
import { createVoiceServer } from './voice-server';

async function main() {
  const args = process.argv.slice(2);
  const get = (flag:string) => {const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  const notesRoot = get('--notes-root');
  const layout = get('--layout') ?? 'auto';
  const model = get('--brain-model') ?? process.env.TYPE_BRAIN_MODEL ?? DEFAULT_BRAIN_MODEL;
  const voice = args.includes('--voice');
  const port = Number(get('--port') ?? '4307');
  const validArgs = args.every((arg,i)=>
    ['--notes-root','--layout','--brain-model','--port'].includes(arg) ||
    ['--notes-root','--layout','--brain-model','--port'].includes(args[i-1]) || arg==='--voice');
  if (!notesRoot || !['auto','legacy','system'].includes(layout) ||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(model) || !validArgs ||
    (voice && (!Number.isInteger(port)||port<0||port>65535))) {
    process.stderr.write('Usage: node brain.mjs --notes-root /absolute/notes [--layout auto|legacy|system] [--brain-model gpt-6-luna] [--voice --port 4307]\n');
    process.exitCode=1;return;
  }
  const repository = await NotesRepository.create(notesRoot,layout as 'auto'|'legacy'|'system');
  const api = new OpenAIApi();
  const notes = await createBrainWithNotes(repository,api.respond,model);
  const brainServer = createBrainMcpServer(notes.brain);
  if (!voice) {
    await brainServer.connect(new StdioServerTransport());
    return;
  }
  const brainClient = new Client({name:'type-voice',version:'0.1.0'});
  const [serverTransport,clientTransport] = InMemoryTransport.createLinkedPair();
  await brainServer.connect(serverTransport); await brainClient.connect(clientTransport);
  const web = createVoiceServer(brainClient,api);
  web.listen(port,'127.0.0.1',()=>{
    const address = web.address();
    if (address && typeof address==='object') process.stderr.write(`Type voice: http://127.0.0.1:${address.port}/\n`);
  });
  const close = async () => {web.close();await brainClient.close();await brainServer.close();await notes.close();};
  process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}
main().catch(error=>{process.stderr.write(`Cannot start Type brain: ${error instanceof Error?error.message:'Unknown error'}\n`);process.exitCode=1;});
