import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rename, rm, cp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesRepository } from './repository';
import { References } from './references';
import { projectDocument } from './projection';

const roots: string[] = [];
const uuid = '12345678-1234-4234-8234-123456789012';
const raw = (body: string) => '---\nid: ' + uuid + '\n---\n' + body;
async function root() { const path = await realpath(await mkdtemp(join(tmpdir(), 'type-references-'))); roots.push(path); return path; }
async function fixture(body: string) {
  const dir = await root();
  await mkdir(join(dir, '_system/stream'), {recursive:true});
  const path = join(dir, '_system/stream/source.md');
  await writeFile(path, raw(body));
  const repository = await NotesRepository.create(dir);
  const source = (await repository.list()).notes[0];
  return {dir, path, repository, references:new References(repository), source};
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, {recursive:true, force:true}))); });

it('projects all heading levels, distinct anchors, allowed links and exact visible line numbers', () => {
  const uri = 'type-note://' + uuid;
  const result = projectDocument('# Карта\n\n## Работа\n\nВидно 😀 [ссылка](' + uri + ')\n\n::: #skip-ai\n## CANARY\n[CANARY](' + uri + ')\n:::\n\n## Работа\n\n### Три\n\n#### Четыре\n\n##### Пять\n\n###### Шесть\n\n[public](https://CANARY)');
  expect(result.outline.map(h => h.level)).toEqual([1,2,2,3,4,5,6]);
  expect(result.outline.filter(h => h.title === 'Работа').map(h => h.anchor)).toEqual(['работа','работа-2']);
  expect(result.links).toEqual([{uri,label:'ссылка',line:5}]);
  expect(JSON.stringify(result)).not.toContain('CANARY');
  expect(result.content.split('\n')[4]).toBe('Видно 😀 ссылка');
  expect(projectDocument('# [CANARY]{#skip-ai}\n\nVisible').outline).toEqual([]);
});

it('keeps citations through rename, copied roots and legacy/system layout changes', async () => {
  const f = await fixture('# Заголовок\n\nПервое 😀\nВторое');
  const cited = await f.references.create(f.source.id, 'citation', {startLine:3,endLine:4}, f.source.revision);
  await rename(f.path, join(f.dir,'_system/stream/renamed.md'));
  const copiedRoot = await root();
  await cp(join(f.dir,'_system'), join(copiedRoot,'_system'), {recursive:true});
  const copied = new References(await NotesRepository.create(copiedRoot));
  expect(await copied.resolve(cited.uri)).toMatchObject({status:'ok',document:{content:'Первое 😀\nВторое',startLine:3,endLine:4}});
  await rename(join(copiedRoot,'_system/stream'), join(copiedRoot,'Feed'));
  expect(await (new References(await NotesRepository.create(copiedRoot,'legacy'))).resolve(cited.uri)).toMatchObject({status:'ok'});
  expect(await f.references.resolve(cited.uri)).toMatchObject({status:'ok'});
});

it('resolves old root-scoped IDs locally without rewriting sources', async () => {
  const f = await fixture('Original');
  const bytes = createHash('sha256').update(f.dir + '\0uuid:stream:' + uuid).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  const oldId = [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  expect(oldId).not.toBe(f.source.id);
  expect(await f.repository.read(oldId)).toMatchObject({id:f.source.id,content:'Original'});
});

it('reports changed, hidden and missing sources without resolving to other text', async () => {
  const f = await fixture('First\n\n::: #skip-ai\nCANARY\n:::\n\nSecond');
  const cited = await f.references.create(f.source.id,'citation',{startLine:3,endLine:3},f.source.revision);
  expect(cited.content).toBe('Second');
  await writeFile(f.path, raw('First\n\n::: #skip-ai\nDIFFERENT_CANARY\n:::\n\nSecond'));
  expect(await f.references.resolve(cited.uri)).toMatchObject({status:'ok'});
  await writeFile(f.path, raw('Changed'));
  expect(await f.references.resolve(cited.uri)).toMatchObject({status:'changed'});
  await expect(f.references.create(f.source.id,'citation',{},f.source.revision)).rejects.toThrow('changed');
  await writeFile(f.path, raw('#skip-ai CANARY'));
  expect(await f.references.resolve(cited.uri)).toEqual({status:'unavailable'});
  await rm(f.path);
  expect(await f.references.resolve(cited.uri)).toEqual({status:'unavailable'});
});

it('does not issue portable links for missing, duplicate or ambiguous metadata identities', async () => {
  const f = await fixture('One');
  await writeFile(join(f.dir,'_system/stream/copy.md'), raw('Duplicate'));
  expect(await f.references.resolve(f.source.uri)).toEqual({status:'unavailable'});
  const duplicates = (await f.repository.list()).notes;
  expect(duplicates.every(n => n.metadata.identityAmbiguous && !n.metadata.portable)).toBe(true);
  await expect(f.references.create(duplicates[0].id,'navigation')).rejects.toThrow('unique');
  await writeFile(f.path,'No UUID');
  const missing = (await f.repository.list()).notes.find(n => n.preview === 'No UUID')!;
  await expect(f.references.create(missing.id,'navigation')).rejects.toThrow('unique');
  await writeFile(f.path,'---\nid: ' + uuid + '\nid: aaaaaaaa-1234-4234-8234-123456789012\n---\nTwo IDs');
  expect((await f.repository.list()).notes.find(n => n.preview === 'Two IDs')?.metadata.portable).toBe(false);
});

it('reads exact sections and detects deleted headings and invalid ranges', async () => {
  const f = await fixture('# Top\n\n## Same\n\nA\n\n## Same\n\nB');
  const section = await f.references.readDocument(f.source.id,{heading:'same-2'});
  expect(section.content).toBe('Same\n\nB');
  const nav = await f.references.create(f.source.id,'navigation',{heading:'same-2'});
  await writeFile(f.path, raw('# New'));
  expect(await f.references.resolve(nav.uri)).toMatchObject({status:'target_unavailable'});
  await expect(f.references.readDocument(f.source.id,{startLine:99})).rejects.toThrow('range');
  await expect(f.references.create(f.source.id,'citation')).rejects.toThrow('revision');
});
