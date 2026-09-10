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
const fingerprint = text => {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i),16777619); b = Math.imul(b,33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
};
const texts = ['Open thought','PRIVATE_CANARY_9482','Another open thought'];
const hashes = texts.map(fingerprint);
const metadata = {version:1,blocks:[{index:1,hash:hashes[1],before:hashes[0],after:hashes[2],document:fingerprint(hashes.join('/')),tags:[{name:'skip-ai',color:'#8b5cf6'}]}]};
const original = `---\ntype_selection_tags: ${JSON.stringify(metadata)}\n---\n${texts.join('\n\n')}`;
try {
  await writeFile(join(root,'PRIVATE_CANARY_9482.md'),original);
  const transport = new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../apps/notes-mcp/dist/main.mjs',import.meta.url)),'--notes-root',root],stderr:'pipe'});
  let errors = '';
  transport.stderr?.on('data', chunk => { errors += chunk; });
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name).sort(),['create_folder','create_note','delete_folder','delete_note','list_agent_folder','list_notes','move_folder','move_note','read_agent_note','read_note','search_notes','update_note']);
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
  const created = await call('create_note',{path:'ideas/test.md',content:'First draft'});
  const own = await call('read_agent_note',{path:created.path});
  await call('update_note',{path:own.path,content:'Revised draft',expectedRevision:own.revision});
  await call('move_note',{source:own.path,destination:'ideas/final.md'});
  assert.equal(await readFile(join(root,'agent/ideas/final.md'),'utf8'),'Revised draft');
  const denied = await client.callTool({name:'create_note',arguments:{path:'../outside.md',content:'BAD'}});
  assert.equal(denied.isError,true);
  await call('delete_folder',{path:'ideas',recursive:true});
  assert.equal(await readFile(join(root,'PRIVATE_CANARY_9482.md'),'utf8'),original);
  assert.equal(errors,'');
  console.log('PASS: stdio initialize, tool catalog, read/search redaction, no filename leak, scoped CRUD, original unchanged.');
} finally {
  await client.close();
  await rm(root,{recursive:true,force:true});
}
