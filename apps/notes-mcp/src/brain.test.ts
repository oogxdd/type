import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NotesRepository } from './repository';
import { createBrainMcpServer, createBrainWithNotes, type ModelCall, type ModelResponse } from './brain';
import { OpenAIApi } from './openai-api';
import { createVoiceServer } from './voice-server';

const roots: string[] = [];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'type-brain-test-'));roots.push(root);
  await mkdir(join(root,'_system','stream'),{recursive:true});
  const path=join(root,'_system','stream','source.md');
  const original='---\nid: 11111111-1111-4111-8111-111111111111\n---\n\nToday I felt calmer.\n\n::: #skip-ai\nCANARY_PRIVATE\n:::';
  await writeFile(path,original);
  return {root,path,original,repository:await NotesRepository.create(root)};
}
const call=(name:string,args:unknown,id:string):ModelResponse=>({status:'completed',output:[{
  type:'function_call',call_id:id,name,arguments:JSON.stringify(args),
}]});
const answer=(text:string):ModelResponse=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});

it('uses filtered MCP reads, verified sources, and saves a real review without leaking private text',async()=>{
  const {repository,path,original}=await fixture();
  const source=(await repository.list(undefined,0,20,{scope:'stream'})).notes[0];
  const seen:Record<string,unknown>[]=[];
  const responses=[
    call('read_note',{id:source.id},'read_1'),
    call('save_artifact',{key:'daily-2026-09-24',kind:'review',body:'# Daily\nCalmer today.',
      sources:[{id:source.id,revision:source.revision,role:'evidence'}],
      reviewType:'day',periodStart:'2026-09-24',periodEnd:'2026-09-24',
      coverageStart:'2026-09-24',coverageEnd:'2026-09-24',partial:false,timezone:'Asia/Tbilisi'},'save_1'),
    answer('I saved a grounded daily review.'),
  ];
  const modelCall:ModelCall=async body=>{seen.push(body);return responses.shift()!;};
  const {brain,close}=await createBrainWithNotes(repository,modelCall);
  try {
    const result=await brain.run({mode:'review',request:'Review 2026-09-24 in Asia/Tbilisi.',summarySize:'short'});
    expect(result.text).toContain('daily review');
    expect(result.toolsUsed).toEqual(['read_note','save_artifact']);
    expect(seen).toHaveLength(3);
    expect(seen.every(body=>body.model==='gpt-6-luna'&&body.store===false)).toBe(true);
    expect(JSON.stringify(seen)).not.toContain('CANARY_PRIVATE');
    const review=(await repository.list(undefined,0,20,{scope:'reviews'})).notes;
    expect(review).toHaveLength(1);
    expect(review[0].metadata.reviewType).toBe('day');
    expect(await readFile(path,'utf8')).toBe(original);
  } finally {await close();}
});

it('refuses unexamined citations and removes write tools for a no-save task',async()=>{
  const {repository}=await fixture();
  const source=(await repository.list(undefined,0,20,{scope:'stream'})).notes[0];
  const seen:Record<string,unknown>[]=[];
  const responses=[
    call('save_artifact',{key:'unread',kind:'review',body:'Unsupported',sources:[{id:source.id,revision:source.revision}],
      reviewType:'day',periodStart:'2026-09-24',periodEnd:'2026-09-24',partial:true,timezone:'UTC'},'save_1'),
    call('write_memory',{area:'me',path:'topic.md',markdown:'No',sources:[],reason:'No'},'write_1'),
    answer('I did not save anything.'),
  ];
  const modelCall:ModelCall=async body=>{seen.push(body);return responses.shift()!;};
  const {brain,close}=await createBrainWithNotes(repository,modelCall);
  try {
    const result=await brain.run({request:'Не сохраняй это.',allowWrites:true});
    expect(result.toolsUsed).toEqual([]);
    expect(JSON.stringify(seen[0].tools)).not.toContain('write_memory');
    expect(JSON.stringify(seen[1].input)).toContain('Tool is not available');
    expect((await repository.list(undefined,0,20,{scope:'reviews'})).notes).toHaveLength(0);
  } finally {await close();}
});

it('builds a weekly review from a read daily review as context',async()=>{
  const {repository}=await fixture();
  const primary=(await repository.list(undefined,0,20,{scope:'stream'})).notes[0];
  const daily=await repository.run(async()=>repository.reviews.createNote('daily/day.md',
    `---\nid: 22222222-2222-4222-8222-222222222222\ngenerated_by: ai\nartifact_type: review\nreview_type: day\nperiod_start: 2026-09-24\nperiod_end: 2026-09-24\nsources_json: '[{"id":"${primary.id}","revision":"${primary.revision}","role":"evidence"}]'\n---\n\n# Day\nCalmer.`));
  expect(daily.path).toBe('daily/day.md');
  const review=(await repository.list(undefined,0,20,{scope:'reviews'})).notes[0];
  const responses=[
    call('read_note',{id:review.id},'read_daily'),
    call('save_artifact',{key:'week-2026-09-21',kind:'review',body:'# Week\nA calmer day.',
      sources:[{id:review.id,revision:review.revision,role:'context'}],reviewType:'week',
      periodStart:'2026-09-21',periodEnd:'2026-09-27',coverageStart:'2026-09-24',coverageEnd:'2026-09-24',
      partial:true,timezone:'Asia/Tbilisi'},'save_week'),
    answer('The partial weekly review is saved.'),
  ];
  const {brain,close}=await createBrainWithNotes(repository,async()=>responses.shift()!);
  try {
    await brain.run({mode:'review',request:'Review 2026-09-21 through 2026-09-27; only 24 Sep is covered.'});
    const weekly=(await repository.list(undefined,0,20,{scope:'reviews',reviewType:'week'})).notes;
    expect(weekly).toHaveLength(1);
    expect(weekly[0].metadata.sources).toEqual([{id:review.id,revision:review.revision,role:'context'}]);
  } finally {await close();}
});

it('exposes the brain as an MCP tool',async()=>{
  const {repository}=await fixture();
  const {brain,close}=await createBrainWithNotes(repository,async()=>answer('A concise answer.'));
  const server=createBrainMcpServer(brain);const client=new Client({name:'test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try {
    const catalog=await client.listTools();
    expect(catalog.tools.map(item=>item.name)).toContain('run_personal_agent');
    const result=await client.callTool({name:'run_personal_agent',arguments:{request:'Hello',allowWrites:false}});
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('A concise answer.');
  } finally {await client.close();await server.close();await close();}
});

it('keeps the API key server-side and uses the selected brain model',async()=>{
  const requests:Array<{url:string;body:Record<string,unknown>}>=[];
  const fakeFetch:typeof fetch=async(input,init)=>{
    const url=String(input);const body=JSON.parse(String(init?.body));requests.push({url,body});
    return new Response(JSON.stringify(url.endsWith('/responses')?answer('Done'):
      {session:{id:'live_123'},transport:{type:'webrtc',sdp:'answer'}}),
      {status:200,headers:{'Content-Type':'application/json'}});
  };
  const api=new OpenAIApi('secret-key',fakeFetch);
  const response=await api.respond({model:'gpt-6-luna',input:'hi'});
  const live=await api.createLiveSession('offer');
  expect(response.status).toBe('completed');expect(live.transport.sdp).toBe('answer');
  expect(requests[0].url).toBe('https://api.openai.com/v1/responses');
  expect(requests[0].body.model).toBe('gpt-6-luna');
  expect((requests[1].body.session as {model:string;delegation:{type:string}}).model).toBe('gpt-live-1');
  expect((requests[1].body.session as {model:string;delegation:{type:string}}).delegation.type).toBe('client');
  expect(JSON.stringify(live)).not.toContain('secret-key');
});

it('accepts only same-origin local voice calls, deduplicates delegations, and honors no-save speech',async()=>{
  const calls:Record<string,unknown>[]=[];
  const brain={callTool:async({arguments:args}:{arguments:Record<string,unknown>})=>{
    calls.push(args);return {content:[{type:'text',text:JSON.stringify({text:'Done',model:'gpt-6-luna',toolsUsed:[]})}]};
  }};
  const live={createLiveSession:async()=>({session:{id:'live_123'},transport:{type:'webrtc',sdp:'answer'}})};
  const server=createVoiceServer(brain as never,live);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');
  const origin=`http://127.0.0.1:${address.port}`;
  const post=(path:string,body:unknown,originHeader?:string)=>fetch(origin+path,{method:'POST',
    headers:{'Content-Type':'application/json',...(originHeader?{Origin:originHeader}:{})},body:JSON.stringify(body)});
  try {
    expect((await fetch(origin)).status).toBe(200);
    expect((await post('/api/session',{sdp:'offer'})).status).toBe(403);
    expect((await post('/api/session',{sdp:'offer'},origin)).status).toBe(201);
    const body={sessionId:'live_123',delegationId:'item_123456',task:{request:'Не сохраняй это.',allowWrites:true}};
    expect((await post('/api/delegation',body,origin)).status).toBe(200);
    expect((await post('/api/delegation',body,origin)).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].allowWrites).toBe(false);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
