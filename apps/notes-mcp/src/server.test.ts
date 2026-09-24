import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NotesRepository } from './repository';
import { createServer } from './server';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true,force:true}))); });
async function folder() { const root = await mkdtemp(join(tmpdir(),'type-mcp-test-')); roots.push(root); return root; }
it('serves the MCP lifecycle and filtered reads and scoped mutation tools without leaking or writing', async () => {
  const root = await folder();
  const raw = 'Visible\n\n::: #skip-ai\nCANARY\n:::';
  const path = join(root,'CANARY-filename.md');
  await writeFile(path,raw);
  const server = createServer(await NotesRepository.create(root));
  const client = new Client({name:'test',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map(tool=>tool.name)).toEqual(expect.arrayContaining(['read_document','create_reference','resolve_reference','check_dependencies','list_memory_folder','move_memory','save_artifact','read_memory','write_memory']));
    expect(tools.tools.find(tool=>tool.name==='resolve_reference')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.tools.find(tool=>tool.name==='move_memory')?.annotations?.readOnlyHint).toBe(false);
    const list = await client.callTool({name:'list_notes',arguments:{}});
    expect(JSON.stringify(list)).not.toContain('CANARY');
    const payload = JSON.parse((list.content as {text:string}[])[0].text);
    const read = await client.callTool({name:'read_note',arguments:{id:payload.notes[0].id}});
    expect(JSON.stringify(read)).toContain('Visible');
    expect(JSON.stringify(read)).not.toContain('CANARY');
    const search = await client.callTool({name:'search_notes',arguments:{query:'CANARY'}});
    expect(JSON.parse((search.content as {text:string}[])[0].text).notes).toEqual([]);
    const invalid = await client.callTool({name:'read_note',arguments:{id:'../CANARY.md'}});
    expect(invalid.isError).toBe(true);
    const mutation = await client.callTool({name:'write_note',arguments:{}});
    expect(mutation.isError).toBe(true);
    const memory = await client.callTool({name:'write_memory',arguments:{area:'me',path:'topic.md',markdown:'# Topic\nSafe memory',sources:[],reason:'Synthetic concurrency fixture.'}});
    expect(memory.isError).not.toBe(true);
    const concurrent = await Promise.all([
      client.callTool({name:'read_document',arguments:{id:payload.notes[0].id}}),
      client.callTool({name:'prepare_context',arguments:{summarySize:'short'}}),
      client.callTool({name:'read_memory',arguments:{area:'me',path:'topic.md'}}),
      client.callTool({name:'read_document',arguments:{id:payload.notes[0].id}}),
    ]);
    for (const response of concurrent) { expect(response.isError).not.toBe(true); expect(JSON.stringify(response)).not.toContain('CANARY'); }
    expect(await readFile(path,'utf8')).toBe(raw);
  } finally { await client.close(); await server.close(); }
});
it('excludes hidden/storage files, symlinks and hard links, and rechecks old IDs', async () => {
  const root = await folder(); const outside = await folder();
  await writeFile(join(outside,'private.md'),'CANARY');
  for (const name of ['.git','Recordings','Attachments']) {
    await mkdir(join(root,name)); await writeFile(join(root,name,'private.md'),'CANARY');
  }
  await writeFile(join(root,'.secret.md'),'CANARY');
  await symlink(outside,join(root,'linked-folder'));
  await symlink(join(outside,'private.md'),join(root,'linked.md'));
  await link(join(outside,'private.md'),join(root,'hard.md'));
  await writeFile(join(root,'safe.md'),'Visible');
  const repo = await NotesRepository.create(root);
  const page = await repo.list();
  expect(page.notes).toHaveLength(1); expect(page.unavailableCount).toBe(0);
  await rm(join(root,'safe.md')); await symlink(join(outside,'private.md'),join(root,'safe.md'));
  await expect(repo.read(page.notes[0].id)).rejects.toThrow('unavailable');
});
it('refreshes filtered reads and paginates', async () => {
  const root = await folder();
  await writeFile(join(root,'a.md'),'first'); await writeFile(join(root,'b.md'),'second');
  const repo = await NotesRepository.create(root);
  const first = await repo.list(undefined,0,1);
  const second = await repo.list(undefined,Number(first.nextCursor),1);
  expect(second.nextCursor).toBeNull(); expect(second.notes[0].preview).toBe('second');
  await writeFile(join(root,'a.md'),'#skip-ai first');
  await expect(repo.read(first.notes[0].id)).rejects.toThrow();
});
