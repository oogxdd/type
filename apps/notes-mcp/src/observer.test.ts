import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NotesRepository } from './repository';
import { Observer } from './observer';
const roots: string[] = [];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function setup() {
 const root=await mkdtemp(join(tmpdir(),'observer-test-')); roots.push(root);
 await mkdir(join(root,'Feed')); await mkdir(join(root,'me')); await mkdir(join(root,'agent'));
 await writeFile(join(root,'Feed','one.md'),'---\nid: 7de0aaab-d9a9-4acf-a931-aa04beee9901\ncreated_ms: 1789817460425\n---\nA permitted experience.');
 return {root,repo:await NotesRepository.create(root)};
}
it('continues across sessions, distinguishes inventory from review, saves idempotently and detects changed/hidden sources',async()=>{
 const {root,repo}=await setup(); const observer=new Observer(repo);
 const prepared=await observer.prepare('review'); expect(prepared.overview).toBeNull(); expect(prepared.layout.kind).toBe('legacy');
 const changes=await observer.changes(); expect(changes.changes).toHaveLength(1);
 const source=changes.changes[0];
 const input={key:'my-day',kind:'review' as const,body:'A provisional review.',sources:[{id:source.id,revision:source.revision}],reviewType:'day' as const,periodStart:'2026-09-19T16:00:00+04:00',periodEnd:'2026-09-20T06:00:00+04:00',partial:true,timezone:'Asia/Tbilisi'};
 const artifact=await observer.saveArtifact(input); expect(artifact.replayed).toBe(false);
 const second=new Observer(await NotesRepository.create(root));
 expect((await second.saveArtifact(input)).replayed).toBe(true);
 expect((await second.changes(changes.snapshot)).changes).toEqual([]);
 await rename(join(root,'Feed','one.md'),join(root,'Feed','renamed.md'));
 expect((await second.changes(changes.snapshot)).changes).toEqual([]);
 const changed=await second.saveArtifact({...input,body:'Expanded review.',expectedRevision:artifact.revision}); expect(changed.replayed).toBe(false);
 expect(changed.area).toBe('reviews');
 expect((await readFile(join(root,changed.area,changed.path),'utf8'))).toContain('review_type: day');
 await writeFile(join(root,'Feed','renamed.md'),'---\nid: 7de0aaab-d9a9-4acf-a931-aa04beee9901\n---\nChanged experience.');
 expect((await second.changes(changes.snapshot)).changes[0].change).toBe('modified');
 await expect(second.saveArtifact({...input,key:'other'})).rejects.toThrow('source changed');
 await writeFile(join(root,'Feed','renamed.md'),'#skip-ai hidden');
 expect((await second.changes(changes.snapshot)).changes[0].change).toBe('unavailable');
}, 30000);
it('updates me with history and stale-write protection without touching stream or creating system folders',async()=>{
 const {root,repo}=await setup(); const observer=new Observer(repo);
 const before=await readFile(join(root,'Feed','one.md'),'utf8');
 const first=await observer.writeMemory('me','overview.md','# Context\nA direct clarification.',[],'User clarified in conversation.');
 const editable=await observer.readMemory('me','overview.md',true); expect('markdown' in editable).toBe(true);
 const updated=await observer.writeMemory('me','overview.md','# Context\nCorrected clarification.',[],'User corrected it.',first.revision);
 expect(updated.revision).not.toBe(first.revision);
 await expect(observer.writeMemory('me','overview.md','Wrong overwrite',[],'test',first.revision)).rejects.toThrow('Revision conflict');
 await expect(observer.writeMemory('me','../Feed/one.md','BAD',[],'test')).rejects.toThrow();
 expect(await readFile(join(root,'Feed','one.md'),'utf8')).toBe(before);
 expect((await observer.prepare('conversation')).overview).toMatchObject({content:expect.stringContaining('Corrected')});
 await expect(readFile(join(root,'_system','me','overview.md'))).rejects.toThrow();
});
it('refuses to update partially hidden memory and rejects duplicate artifacts without revision',async()=>{
 const {root,repo}=await setup(); const observer=new Observer(repo);
 const raw='---\nid: memory\n---\nVisible\n\n::: #skip-ai\nPRIVATE\n:::';
 await writeFile(join(root,'me','overview.md'),raw);
 const read=await observer.readMemory('me','overview.md',false); expect(JSON.stringify(read)).not.toContain('PRIVATE');
 await expect(observer.readMemory('me','overview.md',true)).rejects.toThrow();
 await expect(observer.writeMemory('me','overview.md','Visible',[],'test',read.revision)).rejects.toThrow();
 expect(await readFile(join(root,'me','overview.md'),'utf8')).toBe(raw);
 const input={key:'analysis',kind:'analysis' as const,body:'An analysis',sources:[],partial:true,timezone:'UTC'};
 await observer.saveArtifact(input);
 await expect(observer.saveArtifact({...input,body:'different'})).rejects.toThrow('Artifact exists');
});
it('rejects continuation after source changes and requires explicit review boundaries',async()=>{
 const {root,repo}=await setup(); const observer=new Observer(repo);
 const first=await observer.changes();
 await writeFile(join(root,'Feed','two.md'),'New note');
 await expect(observer.changes(undefined,first.snapshot,1)).rejects.toThrow('Sources changed');
 await expect(observer.saveArtifact({key:'bad',kind:'review',body:'bad',sources:[],partial:true,timezone:'UTC'})).rejects.toThrow('Reviews require');
});
it('prepares recent context and validates persisted snapshot integrity',async()=>{
 const {root,repo}=await setup(); const observer=new Observer(repo);
 await writeFile(join(root,'Feed','older.md'),'---\nid: 7de0aaab-d9a9-4acf-a931-aa04beee9902\ncreated_ms: 1000\n---\nOlder');
 const prepared=await observer.prepare('morning_note',1);
 expect(prepared.stream.notes[0].preview).toBe('A permitted experience.');
 expect(prepared.stream.nextCursor).toBe('1');
 const snapshot=await observer.changes();
 await writeFile(join(root,'agent','observer-state',snapshot.snapshot+'.md'),JSON.stringify({version:1,records:[]}));
 await expect(observer.changes(snapshot.snapshot)).rejects.toThrow('Invalid snapshot');
});

for (const layout of ['legacy', 'system'] as const) {
 it(`loads complete filtered session instructions independently of previews (${layout})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'observer-bootstrap-')); roots.push(root);
  const agent = join(root, layout === 'legacy' ? 'agent' : '_system/agent');
  await mkdir(agent, {recursive:true});
  const longInstructions = 'Personal workflow. '.repeat(40) + 'END_OF_INSTRUCTIONS';
  await writeFile(join(agent, 'AGENTS.md'), longInstructions);
  await writeFile(join(agent, 'session-learning.md'), 'Public agreement\n\n::: #skip-ai\nPRIVATE_BOOTSTRAP_CANARY\n:::\n');
  // These would crowd instructions out of the 20 most recent working previews.
  for (let i = 0; i < 21; i++) await writeFile(join(agent, `recent-${i}.md`), `---\nupdated_ms: ${1900000000000 + i}\n---\nRecent work`);
  const observer = new Observer(await NotesRepository.create(root));
  const prepared = await observer.prepare('conversation', 1);
  expect(prepared.workingMemory.notes).toHaveLength(20);
  expect(prepared.instructionDocuments.find(item => item.path === 'AGENTS.md')?.document).toMatchObject({content:longInstructions});
  expect(prepared.instructionDocuments.find(item => item.path === 'START.md')?.document).toBeNull();
  expect(prepared.instructionDocuments.find(item => item.path === 'session-learning.md')?.document).toMatchObject({content:expect.stringContaining('Public agreement')});
  expect(JSON.stringify(prepared)).not.toContain('PRIVATE_BOOTSTRAP_CANARY');
  await writeFile(join(agent, 'START.md'), '::: #bad!!\nUNAVAILABLE_BOOTSTRAP_CANARY');
  const unavailable = await observer.prepare('conversation');
  expect(unavailable.instructionDocuments.find(item => item.path === 'START.md')?.document).toEqual({unavailable:true});
  expect(JSON.stringify(unavailable)).not.toContain('UNAVAILABLE_BOOTSTRAP_CANARY');
 });
}
