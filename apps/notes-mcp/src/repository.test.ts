import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NotesRepository } from './repository';
import { resolveLayout } from './layout';
const roots: string[] = [];
async function root() { const path = await mkdtemp(join(tmpdir(), 'notes-repository-')); roots.push(path); return path; }
async function put(root: string, path: string, content: string) { const full = join(root,path); await mkdir(join(full,'..'), {recursive:true}); await writeFile(full,content); }
afterEach(async () => { await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true}))); });
const id = '12345678-1234-4234-8234-123456789012';
const note = (body: string, extra = '') => `---\nid: ${id}\ncreated_ms: 1789776000000\n${extra}---\n${body}`;
describe('observer repository', () => {
  it('resolves layouts without creating folders, and refuses ambiguous auto roots', async () => {
    const dir = await root(); expect((await resolveLayout(dir)).kind).toBe('system');
    await mkdir(join(dir,'Feed')); expect((await resolveLayout(dir)).kind).toBe('legacy');
    await mkdir(join(dir,'_system/me'),{recursive:true});
    await expect(resolveLayout(dir)).rejects.toThrow('Both legacy and system');
    expect((await resolveLayout(dir,'legacy')).agent).toBe('agent');
  });
  it('preserves a unique source ID after restart and rename, without disclosing filenames or arbitrary metadata', async () => {
    const dir = await root(); await put(dir,'Feed/secret-filename.md', note('hello','secret: password\n'));
    const repo = await NotesRepository.create(dir); const first = (await repo.list()).notes[0];
    await rename(join(dir,'Feed/secret-filename.md'),join(dir,'Feed/renamed.md'));
    const restarted = await NotesRepository.create(dir);
    expect((await restarted.read(first.id)).content).toBe('hello');
    expect((await restarted.list()).notes[0].id).toBe(first.id);
    expect(JSON.stringify(first)).not.toMatch(/secret|password|filename/);
    expect(first.metadata.kind).toBe('primary'); expect(first.uri).toBe(`type-note://${first.id}`);
  });
  it('keeps duplicate frontmatter identities separate and explicitly ambiguous', async () => {
    const dir = await root(); await put(dir,'Feed/a.md',note('a')); await put(dir,'Feed/b.md',note('b'));
    const repo = await NotesRepository.create(dir); const notes = (await repo.list()).notes;
    expect(notes).toHaveLength(2); expect(new Set(notes.map(n=>n.id)).size).toBe(2);
    expect(notes.every(n=>n.metadata.identityAmbiguous)).toBe(true);
  });
  it('withholds private notes and filters scopes/dates while classifying legacy reviews', async () => {
    const dir = await root();
    await put(dir,'Feed/2026-09-19-review.md', '---\nreview: true\nreview_type: week\n---\nreview text');
    await put(dir,'Feed/private.md', '---\ntags: [skip-ai]\n---\nprivate');
    await put(dir,'Feed/nontake.md', '#nontake\nprivate');
    await put(dir,'me/overview.md','profile');
    const repo = await NotesRepository.create(dir);
    expect((await repo.list()).notes).toHaveLength(2);
    const reviews = (await repo.list(undefined,0,25,{scope:'stream',from:'2026-09-19',to:'2026-09-19'})).notes;
    expect(reviews).toHaveLength(1); expect(reviews[0].metadata.kind).toBe('review');
    expect((await repo.list(undefined,0,25,{scope:'me'})).notes[0].metadata.kind).toBe('profile');
  });
  it('computes read revisions from visible content and safe metadata only', async () => {
    const dir = await root(); await put(dir,'Feed/a.md',note('public\n\n::: #skip-ai\nsecret one\n:::'));
    const repo = await NotesRepository.create(dir); const first = (await repo.list()).notes[0];
    await put(dir,'Feed/a.md',note('public\n\n::: #skip-ai\nsecret two\n:::'));
    expect((await repo.read(first.id)).revision).toBe(first.revision);
    await put(dir,'Feed/a.md',note('changed'));
    expect((await repo.read(first.id)).revision).not.toBe(first.revision);
  });
});

it('separates identities by semantic area and excludes internal state/history', async () => {
  const dir = await root(); await put(dir,'Feed/a.md',note('source'));
  await put(dir,'me/a.md',note('profile'));
  await put(dir,'agent/history/a.md',note('old'));
  await put(dir,'agent/observer-state/a.md','state');
  await put(dir,'agent/memory-updates/a.md','ledger');
  const repo = await NotesRepository.create(dir); const all = await repo.snapshotSources();
  expect(all).toHaveLength(2); expect(all.every(n=>!n.metadata.identityAmbiguous)).toBe(true);
  expect(new Set(all.map(n=>n.id)).size).toBe(2);
  expect(await repo.snapshotSources('stream')).toHaveLength(1);
});
it('never serves replacement UUID content under a cached source identity', async () => {
  const dir = await root(); await put(dir,'Feed/a.md',note('original'));
  const repo = await NotesRepository.create(dir); const first = (await repo.list()).notes[0];
  await put(dir,'Feed/a.md',note('different').replace(id,'aaaaaaaa-1234-4234-8234-123456789012'));
  await expect(repo.read(first.id)).rejects.toThrow('unavailable');
});
it('classifies generated/service stream files and retains offset review boundaries', async () => {
  const dir = await root();
  await put(dir,'Feed/analysis.md',note('analysis','generated_by: ai\nperiod_start: 2026-09-19T20:00:00+04:00\nperiod_end: 2026-09-20T06:00:00+04:00\n'));
  await put(dir,'Feed/AGENTS.md','service instructions');
  const all = await (await NotesRepository.create(dir)).snapshotSources('stream');
  expect(all.find(n=>n.content==='analysis')?.metadata).toMatchObject({kind:'derived',periodEnd:'2026-09-20T06:00:00+04:00'});
  expect(all.find(n=>n.content==='service instructions')?.metadata.kind).toBe('instructions');
});
it('keeps unique stream identity through layout migration in the same root', async () => {
  const dir = await root(); await put(dir,'Feed/a.md',note('source'));
  const before = (await (await NotesRepository.create(dir)).list()).notes[0].id;
  await mkdir(join(dir,'_system')); await rename(join(dir,'Feed'),join(dir,'_system/stream'));
  expect((await (await NotesRepository.create(dir)).read(before)).content).toBe('source');
});

it('scoped snapshots prune unrelated structure trees before enforcing traversal limits', async () => {
  const dir = await root(); await put(dir,'Feed/a.md',note('source'));
  await put(dir,'agent/observation.md','analysis');
  // An unrelated deep knowledge-base tree would fail an unscoped scan.
  await put(dir,`knowledge/${Array(66).fill('nested').join('/')}/a.md`,'unrelated');
  const repo = await NotesRepository.create(dir);
  const sources = await repo.snapshotSources(['stream','agent']);
  expect(sources.map(n=>n.content).sort()).toEqual(['analysis','source']);
  expect(await repo.snapshotSources('stream')).toHaveLength(1);
  await expect(repo.snapshotSources()).rejects.toThrow('depth limit');
});
