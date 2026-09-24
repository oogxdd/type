import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Observer, type ArtifactInput } from './observer';
import { NotesRepository } from './repository';
import { References } from './references';

const roots: string[] = [];
async function root() { const root = await mkdtemp(join(tmpdir(),'type-memory-model-')); roots.push(root); return root; }
async function setup(layout: 'system' | 'legacy' = 'system') {
  const dir = await root();
  const stream = layout === 'system' ? '_system/stream' : 'Feed';
  await mkdir(join(dir,stream),{recursive:true});
  const raw = '---\nid: 12345678-1234-4234-8234-123456789012\ncreated_ms: 1789776000000\n---\n# Переезд\n\nСегодня переехал из А в Б.';
  await writeFile(join(dir,stream,'source.md'), raw);
  const repo = await NotesRepository.create(dir);
  return {dir,stream,raw,repo,observer:new Observer(repo),references:new References(repo)};
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path,{recursive:true,force:true}))); });
const review = (key: string, type: 'day' | 'week' = 'day'): ArtifactInput => ({key,kind:'review',body:'# Review',sources:[],reviewType:type,
  periodStart:'2026-09-19',periodEnd:'2026-09-20',coverageStart:'2026-09-19',coverageEnd:'2026-09-19',partial:true,timezone:'Asia/Tbilisi'});

for (const layout of ['system','legacy'] as const) {
  it('supports source → daily → weekly → me → summaries and back to source (' + layout + ')', async () => {
    const f = await setup(layout);
    const primary = (await f.repo.snapshotSources('stream'))[0];
    const citation = await f.references.create(primary.id,'citation',{startLine:3,endLine:3},primary.revision);
    const daily = await f.observer.saveArtifact({...review('day:2026-09-19'),body:'# Переезд\n\n[Запись](' + citation.uri + ')',sources:[primary]});
    expect(daily.area).toBe('reviews');
    expect(daily.path).toMatch(/^daily\/2026-09-19-/);
    const week = await f.observer.saveArtifact({...review('week:2026-09-14','week'),periodStart:'2026-09-14',body:'# Неделя\n\n[День](' + daily.source!.uri + ')',sources:[daily.source!,{...primary,role:'context'}]});
    const profile = await f.observer.writeMemory('me','life/location.md','# Место жизни\n\nЖивёт в Б с сентября; раньше жил в А. [Источник](' + citation.uri + ')',
      [{...primary,role:'evidence'},{...week.source!,role:'context'}],'Updated current residence and kept the meaningful change.');
    const topic = await f.references.create(profile.source!.id,'navigation',{heading:'место-жизни'});
    for (const size of ['short','medium','large'] as const) {
      const summary = await f.observer.writeMemory('me','summaries/' + size + '.md','# Summary\n\n[Место жизни](' + topic.uri + ')', [profile.source!], 'Summarized the map.');
      const read = await f.repo.read(summary.source!.id);
      expect(read.links[0].uri).toBe(topic.uri);
      expect((await f.observer.prepare('conversation',1,0,size)).summary?.document).toMatchObject({content:expect.stringContaining('Место жизни')});
      expect(await f.references.checkDependencies(summary.source!.id)).toMatchObject({status:'current'});
    }
    const editable = await f.observer.readMemory('me',profile.path,true);
    expect(editable.revision).not.toBe(editable.source!.revision);
    await f.observer.moveMemory('me','life','biography','folder');
    expect(await f.references.resolve(topic.uri)).toMatchObject({status:'ok',document:{content:expect.stringContaining('Живёт в Б')}});
    const resolvedMap = await f.references.resolve(topic.uri);
    if (resolvedMap.status !== 'ok') throw new Error('Map link did not resolve');
    expect(await f.references.resolve(resolvedMap.document.links[0].uri)).toMatchObject({status:'ok',document:{content:'Сегодня переехал из А в Б.'}});
    expect((await f.observer.listMemory('me')).entries.map(item=>item.path)).toEqual(['biography','summaries']);
    expect((await f.repo.list(undefined,0,25,{kind:'review',reviewType:'week',from:'2026-09-19',to:'2026-09-19'})).notes.map(note=>note.id)).toEqual([week.source!.id]);
    expect((await f.repo.read(week.source!.id)).metadata).toMatchObject({partial:true,coverageStart:'2026-09-19',sources:[{role:'evidence'},{role:'context'}]});
    const original = await readFile(join(f.dir,f.stream,'source.md'),'utf8');
    expect(original).toBe(f.raw);
    expect((await f.observer.changes()).changes).toHaveLength(1);
    const copiedRoot = await root();
    await cp(f.dir,copiedRoot,{recursive:true});
    const copied = new References(await NotesRepository.create(copiedRoot));
    expect(await copied.resolve(topic.uri)).toMatchObject({status:'ok'});
    expect(await copied.resolve(citation.uri)).toMatchObject({status:'ok'});
  });
}

it('preserves idempotent review keys after moves and flags changed dependencies', async () => {
  const f = await setup();
  const dailyInput = review('stable-day');
  const daily = await f.observer.saveArtifact(dailyInput);
  const weekly = await f.observer.saveArtifact({...review('stable-week','week'),sources:[daily.source!]});
  await f.observer.moveMemory('reviews',daily.path,'daily/renamed.md','note',daily.revision);
  expect(await f.observer.saveArtifact(dailyInput)).toMatchObject({path:'daily/renamed.md',replayed:true});
  await f.observer.saveArtifact({...dailyInput,body:'# Updated',expectedRevision:daily.revision});
  expect(await f.references.checkDependencies(weekly.source!.id)).toMatchObject({status:'stale',dependencies:[{status:'changed',kind:'review'}]});
  await expect(f.observer.saveArtifact({...review('other-week','week'),sources:[daily.source!]})).rejects.toThrow('source changed');
  await writeFile(join(f.dir,'_system/reviews/daily/renamed.md'),'#skip-ai CANARY');
  const dependencies = await f.references.checkDependencies(weekly.source!.id);
  expect(dependencies).toMatchObject({status:'stale',dependencies:[{status:'unavailable'}]});
  expect(JSON.stringify(dependencies)).not.toContain('CANARY');
});

it('keeps Git as default history, supports explicit retained versions and rejects stale writes/moves', async () => {
  const f = await setup();
  const first = await f.observer.writeMemory('me','values.md','# Values\nFirst',[],'Direct clarification.');
  const second = await f.observer.writeMemory('me','values.md','# Values\nSecond',[],'New clarification.',first.revision);
  expect(second.history).toBeNull();
  expect(second.source!.id).toBe(first.source!.id);
  await expect(readdir(join(f.dir,'_system/agent/history'))).rejects.toMatchObject({code:'ENOENT'});
  const third = await f.observer.writeMemory('me','values.md','# Values\nThird',[],'Keep prior version for comparison.',second.revision,true);
  expect(third.history).toContain('retained');
  expect(await readdir(join(f.dir,'_system/agent/history/me'))).toHaveLength(1);
  await expect(f.observer.writeMemory('me','values.md','# Wrong',[],'Stale',first.revision)).rejects.toThrow('Revision conflict');
  await expect(f.observer.moveMemory('me','values.md','changed.md','note',first.revision)).rejects.toThrow('Revision conflict');
  const moved = await f.observer.moveMemory('me','values.md','beliefs/values.md','note',third.revision);
  expect(moved.source!.id).toBe(first.source!.id);
  await expect(f.observer.deleteMemory('me',moved.path,first.revision)).rejects.toThrow('Revision conflict');
  await f.observer.deleteMemory('me',moved.path,third.revision);
  expect(await f.references.resolve(first.source!.uri)).toEqual({status:'unavailable'});
  await expect(f.observer.writeMemory('me','../stream/source.md','BAD',[],'Escape')).rejects.toThrow();
  await expect(f.observer.moveMemory('reviews','','nested','folder')).rejects.toThrow();
  expect(await readFile(join(f.dir,f.stream,'source.md'),'utf8')).toBe(f.raw);
});

it('returns explicit summary availability, complete selected text and a filtered memory tree', async () => {
  const f = await setup();
  await f.observer.writeMemory('me','overview.md','Legacy overview',[],'Legacy context.');
  const text = '# Summary\n' + 'Long public text. '.repeat(50);
  await f.observer.writeMemory('me','summaries/large.md',text,[],'Full summary.');
  await f.observer.writeMemory('me','README.md','# Map\nUse life topics.',[],'Navigation.');
  const selected = await f.observer.prepare('review',1,0,'large');
  expect(selected.overview).toBeNull();
  expect(selected.mapIndex).toMatchObject({content:expect.stringContaining('Map')});
  expect(selected.summary?.document).toMatchObject({content:expect.stringContaining('Long public text. '.repeat(49))});
  expect((await f.observer.prepare('review',1,0,'short')).summary?.document).toBeNull();
  await writeFile(join(f.dir,'_system/me/summaries/medium.md'),'#skip-ai CANARY');
  await writeFile(join(f.dir,'_system/me/CANARY.md'),'#skip-ai CANARY');
  expect((await f.observer.prepare('review',1,0,'medium')).summary?.document).toEqual({unavailable:true});
  expect(JSON.stringify(await f.observer.listMemory('me'))).not.toContain('CANARY');
  const page = await f.observer.listMemory('me','',0,1);
  expect(page.nextCursor).toBe('1');
  expect((await f.observer.listMemory('me','',Number(page.nextCursor),10)).nextCursor).toBeNull();
  expect((await f.observer.prepare('review')).overview).toMatchObject({content:'Legacy overview'});
});

it('updates legacy artifacts in place and supports extended review periods and coverage checks', async () => {
  const f = await setup('legacy');
  const key = 'legacy-review';
  const path = 'artifacts/' + createHash('sha256').update(key).digest('hex') + '.md';
  await f.repo.agent.createNote(path,'---\nid: aaaaaaaa-1234-4234-8234-123456789012\nreview: true\nartifact_type: review\nreview_type: day\n---\nOld review');
  const prior = await f.observer.readMemory('agent',path,true);
  const updated = await f.observer.saveArtifact({...review(key),expectedRevision:prior.revision});
  expect(updated).toMatchObject({area:'agent',path});
  await expect(f.observer.saveArtifact({...review('invalid'),coverageStart:'2026-09-10'})).rejects.toThrow('Coverage');
  await expect(f.observer.saveArtifact({...review('invalid'),periodStart:'2026-02-30'})).rejects.toThrow('valid ISO');
  await expect(f.observer.saveArtifact({...review('invalid'),periodStart:'2026-09-19T24:00:00Z'})).rejects.toThrow('valid ISO');
  await expect(f.observer.saveArtifact({...review('invalid'),partial:false})).rejects.toThrow('full period');
  for (const type of ['quarter','year','period'] as const) {
    const artifact = await f.observer.saveArtifact({...review(type),reviewType:type,coverageStart:undefined,coverageEnd:undefined,partial:false});
    expect((await f.repo.read(artifact.source!.id)).metadata).toMatchObject({reviewType:type,partial:false,coverageStart:'2026-09-19',coverageEnd:'2026-09-20'});
  }
});
