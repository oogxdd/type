// Real stdio MCP handshake/tool test. Uses temporary fixtures, never user notes.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = await mkdtemp(join(tmpdir(), 'type-mcp-stdio-'));
const client = new Client({ name: 'type-mcp-smoke', version: '1' });
const original = 'Open thought\n\n::: #skip-ai\nPRIVATE_CANARY_9482\n:::\n\nAnother open thought';
try {
  await writeFile(join(root,'PRIVATE_CANARY_9482.md'),original);
  const transport = new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../apps/notes-mcp/dist/main.mjs',import.meta.url)),'--notes-root',root],stderr:'pipe'});
  let errors = '';
  transport.stderr?.on('data', chunk => { errors += chunk; });
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name).sort(),['create_folder','create_note','delete_folder','delete_note','list_agent_folder','list_changes','list_notes','move_folder','move_note','prepare_context','read_agent_note','read_memory','read_note','save_artifact','search_notes','update_note','write_memory'].sort());
  const call = async (name,args={}) => {
    const result = await client.callTool({name,arguments:args});
    assert.ok(!result.isError,JSON.stringify(result));
    assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY_9482'));
    return JSON.parse(result.content[0].text);
  };
  const page = await call('list_notes');
  assert.equal(page.notes.length,1);
  assert.equal((await call('read_note',{id:page.notes[0].id})).content,'Open thought\n\nAnother open thought');
  assert.equal((await call('search_notes',{query:'PRIVATE_CANARY_9482'})).notes.length,0);
  assert.equal(await readFile(join(root,'PRIVATE_CANARY_9482.md'),'utf8'),original);
  for (const content of ['Open thought\n\n::: #skip-ai\nPRIVATE_CANARY_9482', '::: #bad!!\nPRIVATE_CANARY_9482']) {
    await writeFile(join(root, 'PRIVATE_CANARY_9482.md'), content);
    await call('list_notes');
    await call('search_notes', { query: 'PRIVATE_CANARY_9482' });
    const result = await client.callTool({ name: 'read_note', arguments: { id: page.notes[0].id } });
    assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY_9482'));
  }
  await writeFile(join(root, 'PRIVATE_CANARY_9482.md'), original);
  const created = await call('create_note',{path:'ideas/test.md',content:'First draft'});
  const own = await call('read_agent_note',{path:created.path});
  await call('update_note',{path:own.path,content:'Revised draft',expectedRevision:own.revision});
  await call('move_note',{source:own.path,destination:'ideas/final.md'});
  assert.equal(await readFile(join(root,'_system/agent/ideas/final.md'),'utf8'),'Revised draft');
  const denied = await client.callTool({name:'create_note',arguments:{path:'../outside.md',content:'BAD'}});
  assert.equal(denied.isError,true);
  await call('delete_folder',{path:'ideas',recursive:true});
  assert.equal(await readFile(join(root,'PRIVATE_CANARY_9482.md'),'utf8'),original);
  const context = await call('prepare_context',{mode:'conversation'});
  assert.equal(context.overview,null);
  const memory = await call('write_memory',{area:'me',path:'overview.md',markdown:'# About me\nA user-confirmed preference.',sources:[],reason:'Direct clarification in this synthetic test.'});
  const editable = await call('read_memory',{area:'me',path:'overview.md',editable:true});
  assert.ok(editable.markdown.includes('user-confirmed'));
  await call('write_memory',{area:'me',path:'overview.md',markdown:'# About me\nAn updated preference.',sources:[],reason:'Correction.',expectedRevision:memory.revision});
  const artifact = {key:'smoke-observation',kind:'observation',body:'One tentative observation.',sources:[],partial:true};
  const saved = await call('save_artifact',artifact);
  assert.equal((await call('save_artifact',artifact)).replayed,true);
  assert.ok(saved.path.startsWith('artifacts/'));
  const snapshot = await call('list_changes');
  assert.deepEqual((await call('list_changes',{since:snapshot.snapshot})).changes,[]);
  assert.equal(errors,'');
  console.log('PASS: stdio initialize, tool catalog, read/search redaction, no filename leak, scoped CRUD, observer context, memory history, idempotent artifacts, snapshots, original unchanged.');
} finally {
  await client.close();
  await rm(root,{recursive:true,force:true});
}
