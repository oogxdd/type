// Built stdio brain smoke. Uses an empty synthetic notes root and no API key.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root=await mkdtemp(join(tmpdir(),'type-brain-stdio-'));
const client=new Client({name:'type-brain-smoke',version:'1'});
const env=Object.fromEntries(Object.entries(process.env).filter(([,value])=>value!==undefined));
env.OPENAI_API_KEY='';
try {
  const transport=new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL('../apps/notes-mcp/dist/brain.mjs',import.meta.url)),'--notes-root',root],
    env,stderr:'pipe'});
  let stderr='';transport.stderr?.on('data',chunk=>{stderr+=chunk;});
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name),['run_personal_agent']);
  const result=await client.callTool({name:'run_personal_agent',arguments:{request:'Hello',allowWrites:false}});
  assert.equal(result.isError,true);
  assert.match(result.content[0].text,/OPENAI_API_KEY/);
  assert.equal(stderr,'');
  assert.deepEqual(await readdir(root),[]);
  console.log('PASS: built brain MCP stdio lifecycle, tool catalog, missing-key error, no writes.');
} finally {await client.close();await rm(root,{recursive:true,force:true});}
