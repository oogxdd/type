// Real stdio MCP handshake/tool test. Uses temporary fixtures, never user notes.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
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
  const catalog = (await client.listTools()).tools.map(tool=>tool.name);
  for (const name of ['read_document','create_reference','resolve_reference','check_dependencies','list_memory_folder','move_memory','prepare_context','read_memory','write_memory','save_artifact']) assert.ok(catalog.includes(name));
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
  assert.equal((await call('read_agent_note',{path:'ideas/final.md'})).content,'Revised draft');
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
  await mkdir(join(root,'_system/stream'),{recursive:true});
  const sourceRaw = '---\nid: 12345678-1234-4234-8234-123456789012\n---\n' + original;
  await writeFile(join(root,'_system/stream/source.md'),sourceRaw);
  const source = (await call('list_notes',{scope:'stream'})).notes[0];
  const document = await call('read_document',{id:source.id,startLine:3,endLine:3});
  assert.equal(document.content,'Another open thought');
  const citation = await call('create_reference',{id:source.id,expectedRevision:source.revision,startLine:3,endLine:3});
  const daily = await call('save_artifact',{key:'smoke-day',kind:'review',body:'[Source](' + citation.uri + ')',sources:[{id:source.id,revision:source.revision,role:'evidence'}],reviewType:'day',periodStart:'2026-09-24',periodEnd:'2026-09-24',partial:false});
  assert.equal(daily.area,'reviews');
  const weekly = await call('save_artifact',{key:'smoke-week',kind:'review',body:'A week in context.',sources:[daily.source],reviewType:'week',periodStart:'2026-09-21',periodEnd:'2026-09-27',coverageStart:'2026-09-24',coverageEnd:'2026-09-24',partial:true});
  const profile = await call('write_memory',{area:'me',path:'life.md',markdown:'# Life\n\n[Source](' + citation.uri + ')',sources:[{...source,role:'evidence'},{...weekly.source,role:'context'}],reason:'Synthetic interpretation.'});
  const navigation = await call('create_reference',{id:profile.source.id,kind:'navigation',heading:'life'});
  const summary = await call('write_memory',{area:'me',path:'summaries/short.md',markdown:'[Life](' + navigation.uri + ')',sources:[profile.source],reason:'Synthetic summary.'});
  assert.equal((await call('check_dependencies',{id:summary.source.id})).status,'current');
  assert.equal((await call('prepare_context',{summarySize:'short'})).summary.document.content,'Life');
  assert.ok((await call('list_memory_folder',{area:'me'})).entries.some(entry=>entry.path==='summaries'));
  await call('move_memory',{area:'me',source:'life.md',destination:'biography/life.md',expectedRevision:profile.revision});
  const linked = await call('resolve_reference',{uri:navigation.uri});
  assert.equal(linked.status,'ok');
  assert.equal((await call('resolve_reference',{uri:linked.document.links[0].uri})).document.content,'Another open thought');
  assert.equal(await readFile(join(root,'_system/stream/source.md'),'utf8'),sourceRaw);
  const snapshot = await call('list_changes');
  assert.deepEqual((await call('list_changes',{since:snapshot.snapshot})).changes,[]);
  assert.equal(errors,'');
  console.log('PASS: stdio lifecycle, privacy, scoped CRUD, source → daily → weekly → me → summary → citation, memory moves, dependencies, selectable context, idempotent artifacts, snapshots, originals unchanged.');
} finally {
  await client.close();
  await rm(root,{recursive:true,force:true});
}
