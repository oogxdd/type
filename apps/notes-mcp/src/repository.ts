import { AgentWorkspace } from './agent-workspace';
import { constants } from 'node:fs';
import { lstat, realpath, readdir, open } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFrontmatterScalar, splitFrontmatter } from '@typenotes/shared/frontmatter';
import { resolveLayout, type LayoutMode, type ResolvedLayout, type MemoryArea } from './layout';
import { projectDocument, ProjectionError } from './projection';
import { sourceDependencies } from './document-metadata';

const MAX_BYTES = 1024 * 1024;
// Binary storage, matched per path segment. The legacy root-level names stay
// listed because a notes root predating the `_system` layout still has them.
const excluded = new Set([
  '_recordings', '_handwriting', '_attachments',
  'Recordings', 'Attachments', '_Recordings',
]);
export class NotesRepository {
  private requests: Promise<unknown> = Promise.resolve();
  private paths = new Map<string, string>();
  private aliases = new Map<string, string>();
  private identities = new Map<string, {identityAmbiguous: boolean; identityBasis: 'frontmatter' | 'path'}>();
  private expectedUUID = new Map<string, string | null>();
  readonly agent: AgentWorkspace;
  readonly me: AgentWorkspace;
  readonly reviews: AgentWorkspace;
  private constructor(private root: string, readonly layout: ResolvedLayout) {
    this.agent = new AgentWorkspace(root, layout.agent.split('/'));
    this.me = new AgentWorkspace(root, layout.me.split('/'));
    this.reviews = new AgentWorkspace(root, layout.reviews.split('/'));
  }
  /** A discovery map belongs to one MCP request, including its scoped subreads. */
  async run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.requests.then(action);
    this.requests = result.catch(() => {});
    return result;
  }
  static async create(root: string, mode: LayoutMode = 'auto') {
    if (!isAbsolute(root)) throw new Error('Use an absolute notes-root path.');
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw new Error('Notes root must be a directory.');
    return new NotesRepository(canonical, await resolveLayout(canonical, mode));
  }
  private async checked(path: string) {
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error();
    let current = this.root;
    if (await realpath(this.root) !== this.root) throw new Error();
    for (const part of rel.split(sep)) {
      if (part.startsWith('.') || excluded.has(part)) throw new Error();
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error();
    }
    if (await realpath(path) !== path) throw new Error();
  }
  private scope(path: string): NoteScope {
    const rel = relative(this.root, path).split(sep).join('/');
    return (['stream', 'me', 'agent', 'reviews'] as const).find(area => rel === this.layout[area] || rel.startsWith(`${this.layout[area]}/`)) ?? 'structure';
  }
  async inventory(capture?: Map<string, string>, scopes?: NoteScope[]): Promise<string[]> {
    const candidates: {path: string; uuid: string | null; raw: string; key: string}[] = [];
    let visited = 0;
    const walk = async (dir: string, depth: number) => {
      // A scoped observation must not parse unrelated knowledge-base documents.
      // Retain ancestors of selected areas so their paths can be traversed.
      if (scopes && !scopes.includes('structure') && dir !== this.root) {
        const rel = relative(this.root, dir).split(sep).join('/');
        if (!scopes.some(area => {
          const selected = this.layout[area as 'stream' | MemoryArea];
          return rel === selected || rel.startsWith(`${selected}/`) || selected.startsWith(`${rel}/`);
        })) return;
      }
      if (depth > 64) throw new Error('Folder depth limit exceeded.');
      if (dir !== this.root) await this.checked(dir);
      else if (await realpath(dir) !== this.root) throw new Error('Notes root changed.');
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        if (++visited > 100_000) throw new Error('Folder entry limit exceeded.');
        if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.isSymbolicLink()) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          const area = this.scope(path);
          if ((area === 'agent' || area === 'me' || area === 'reviews') && ['history', 'state', 'observer-state', 'memory-updates'].includes(entry.name.toLowerCase())) continue;
          await walk(path, depth + 1);
        }
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          if (scopes && !scopes.includes(this.scope(path))) continue;
          try {
            const raw = await this.raw(path);
            if (!visible(raw).content) continue;
            const uuid = sourceUUID(raw);
            candidates.push({path, uuid, raw, key: `${this.scope(path)}:${uuid}`});
          } catch { /* Withhold unavailable or malformed notes, including their metadata. */ }
        }
      }
    };
    await walk(this.root, 0);
    const counts = new Map<string, number>();
    for (const item of candidates) if (item.uuid) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
    this.paths.clear(); this.aliases.clear(); this.identities.clear(); this.expectedUUID.clear();
    for (const item of candidates) {
      const ambiguous = Boolean(item.uuid && counts.get(item.key)! > 1);
      const basis = item.uuid && !ambiguous ? `uuid:${item.key}` : `path:${relative(this.root, item.path)}`;
      const oldId = opaqueUUID(`${this.root}\0${basis}`);
      const id = item.uuid && !ambiguous ? opaqueUUID('type-note:v2\0' + basis) : oldId;
      this.aliases.set(oldId, id);
      this.paths.set(id, item.path);
      this.expectedUUID.set(id, item.uuid);
      capture?.set(id, item.raw);
      this.identities.set(id, {identityAmbiguous: ambiguous, identityBasis: item.uuid && !ambiguous ? 'frontmatter' : 'path'});
    }
    return [...this.paths.keys()];
  }
  private async raw(path: string): Promise<string> {
    let raw: string;
    try {
      await this.checked(path);
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error();
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > MAX_BYTES) throw new Error();
        const readStat = await handle.stat();
        if (readStat.size !== stat.size || readStat.mtimeMs !== stat.mtimeMs || readStat.ctimeMs !== stat.ctimeMs) throw new Error();
        await this.checked(path);
        const after = await lstat(path);
        if (after.ino !== stat.ino || after.dev !== stat.dev) throw new Error();
        raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
      } finally { await handle.close(); }
    } catch { throw new ProjectionError('Note unavailable (changed, linked, unreadable, or larger than 1 MiB).'); }
    return raw;
  }
  async read(id: string, refresh = true) {
    // Public reads refresh identity too: a new duplicate must not inherit a link.
    // Batch callers can inventory once, then recheck bytes with refresh=false.
    if (refresh) await this.inventory();
    id = this.aliases.get(id) ?? id;
    const path = this.paths.get(id);
    if (!path) throw new ProjectionError('Unknown or unavailable note ID.');
    return this.readKnown(id, path);
  }
  private async readKnown(id: string, path: string) {
    const raw = await this.raw(path);
    return this.describe(id, path, raw);
  }
  private describe(id: string, path: string, raw: string) {
    if (sourceUUID(raw) !== this.expectedUUID.get(id)) throw new ProjectionError('Source identity changed.');
    const document = visible(raw);
    if (!document.content) throw new ProjectionError('Note unavailable.');
    const scope = this.scope(path);
    const review = readFrontmatterScalar(raw, 'review') === 'true';
    const service = /^(?:AGENTS|README|START|INDEX|SOURCES)\.md$/i.test(basename(path));
    const generated = /^(?:ai|agent|assistant|llm)$/i.test(readFrontmatterScalar(raw, 'generated_by') ?? '') || ['analysis','observation','morning_note','review','summary'].includes(readFrontmatterScalar(raw, 'artifact_type') ?? '');
    const metadata = {
      scope, kind: service ? 'instructions' : review || scope === 'reviews' ? 'review' : scope === 'me' && readFrontmatterScalar(raw, 'artifact_type') !== 'summary' ? 'profile' : generated ? 'derived' : scope === 'stream' ? 'primary' : scope === 'agent' ? 'working' : 'structure',
      ...this.identities.get(id), portable: this.identities.get(id)?.identityBasis === 'frontmatter', ...safeMetadata(raw),
      ...(/^\d{4}-\d{2}-\d{2}(?:[^0-9]|$)/.test(basename(path)) ? {recordedDate: safeDate(basename(path).slice(0,10))} : {}),
    };
    return {id, uri: `type-note://${id}`, ...document, metadata, revision: createHash('sha256').update(JSON.stringify({document, metadata})).digest('hex')};
  }

  /** Relative memory paths are an explicit capability; source filenames stay private. */
  memoryLocation(id: string): {area: MemoryArea; path: string} | null {
    const path = this.paths.get(this.aliases.get(id) ?? id);
    if (!path) return null;
    const area = this.scope(path);
    if (area !== 'me' && area !== 'agent' && area !== 'reviews') return null;
    return {area, path: relative(join(this.root, this.layout[area]), path).split(sep).join('/')};
  }

  async memorySource(area: MemoryArea, path: string) {
    const notes = await this.snapshotSources(area);
    return notes.find(note => this.memoryLocation(note.id)?.path === path) ?? null;
  }

  async findArtifact(keyHash: string) {
    const notes = await this.snapshotSources(['agent', 'reviews']);
    const matches = notes.filter(note => note.metadata.artifactKey === keyHash);
    if (matches.length > 1) throw new ProjectionError('Artifact key is ambiguous; resolve duplicate artifacts explicitly.');
    return matches.length ? this.memoryLocation(matches[0].id) : null;
  }
  /** Fresh bounded filesystem snapshot, without repeated discovery per list page. */
  async snapshotSources(scope: NoteScope | NoteScope[] | 'all' = 'all') {
    const capture = new Map<string, string>();
    const scopes = scope === 'all' ? undefined : Array.isArray(scope) ? scope : [scope];
    await this.inventory(capture, scopes);
    return [...capture].flatMap(([id, raw]) => {
      const path = this.paths.get(id)!;
      if (scopes && !scopes.includes(this.scope(path))) return [];
      return [this.describe(id, path, raw)];
    });
  }
  async list(query?: string, cursor = 0, limit = 25, options: ListOptions = {}) {
    const ids = await this.inventory();
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > ids.length) throw new ProjectionError('Invalid cursor; restart listing.');
    const notes: ReturnType<typeof notePreview>[] = [];
    let unavailableCount = 0;
    let next = cursor;
    for (const id of ids.slice(cursor, cursor + 200)) {
      next++;
      try {
        const note = await this.readKnown(id, this.paths.get(id)!);
        if (options.scope && options.scope !== 'all' && note.metadata.scope !== options.scope) continue;
        if (options.kind && note.metadata.kind !== options.kind) continue;
        if (options.reviewType && note.metadata.reviewType !== options.reviewType) continue;
        const date = note.metadata.recordedDate ?? note.metadata.createdAt?.slice(0,10);
        const from = note.metadata.kind === 'review' ? note.metadata.periodStart?.slice(0,10) ?? date : date;
        const to = note.metadata.kind === 'review' ? note.metadata.periodEnd?.slice(0,10) ?? date : date;
        if (options.from && (!to || to < options.from) || options.to && (!from || from > options.to)) continue;
        const lines = note.content.split('\n');
        const line = query === undefined ? lines.find(line => line.trim()) ?? '' : lines.find(line => line.toLowerCase().includes(query.toLowerCase()));
        if (line !== undefined) notes.push({...notePreview(note), preview: [...line].slice(0, 240).join('')});
      } catch { unavailableCount++; }
      if (notes.length >= limit) break;
    }
    return { notes, nextCursor: next < ids.length ? String(next) : null, unavailableCount };
  }
}

export type NoteScope = 'stream' | MemoryArea | 'structure';
export type ReviewType = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'period';
export type ListOptions = {scope?: NoteScope | 'all'; from?: string; to?: string; kind?: string; reviewType?: ReviewType};
export type SourceNote = Awaited<ReturnType<NotesRepository['read']>>;
export function notePreview(note: SourceNote) {
  const {content, outline: _outline, links: _links, ...metadata} = note;
  return {...metadata, preview: [...content].slice(0, 240).join('')};
}
function opaqueUUID(value: string) {
  const bytes = createHash('sha256').update(value).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function visible(raw: string) {
  // Legacy privacy marker is conservative even in prose/code: never publish its note.
  if (/(?:^|[^\w-])#?nontake(?:$|[^\w-])/im.test(raw)) return {content: '', outline: [], links: []};
  return projectDocument(raw);
}
function safeDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10) === value ? value : undefined;
}
function sourceUUID(raw: string) {
  if ((splitFrontmatter(raw.replace(/^\uFEFF/, '')).frontmatterBlock ?? '').split('\n').filter(line => /^\s*id\s*:/.test(line)).length !== 1) return null;
  const value = readFrontmatterScalar(raw, 'id');
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
function safePeriod(value: string | null) {
  const date = safeDate(value);
  if (date) return date;
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !safeDate(value.slice(0,10))) return undefined;
  const clock = value.slice(11,19).split(':').map(Number);
  const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
  if (clock[0] > 23 || clock[1] > 59 || clock[2] > 59 || offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}
function safeMetadata(raw: string) {
  const scalar = (key: string) => readFrontmatterScalar(raw, key);
  const timestamp = (key: string) => {
    const value = scalar(key);
    if (!value || !/^\d{1,16}$/.test(value)) return undefined;
    const ms = Number(value);
    return Number.isSafeInteger(ms) && ms >= 0 && ms <= 253402300799999 ? new Date(ms).toISOString() : undefined;
  };
  const reviewType = scalar('review_type');
  const artifactKey = scalar('artifact_key');
  const dependencies = sourceDependencies(raw);
  let timezone: string | undefined;
  const candidateTimezone = scalar('timezone');
  if (candidateTimezone && candidateTimezone.length <= 80) {
    try { new Intl.DateTimeFormat('en', {timeZone: candidateTimezone}); timezone = candidateTimezone; } catch { /* Withhold arbitrary metadata. */ }
  }
  return {
    sources: dependencies ?? [], dependenciesUnavailable: dependencies === null,
    artifactKey: artifactKey && /^[a-f0-9]{64}$/.test(artifactKey) ? artifactKey : undefined,
    createdAt: timestamp('created_ms'), updatedAt: timestamp('updated_ms'),
    review: scalar('review') === 'true',
    reviewType: reviewType && ['day','week','month','quarter','year','period'].includes(reviewType) ? reviewType : undefined,
    periodStart: safePeriod(scalar('period_start')), periodEnd: safePeriod(scalar('period_end')),
    coverageStart: safePeriod(scalar('coverage_start')), coverageEnd: safePeriod(scalar('coverage_end')),
    timezone,
    partial: scalar('partial') === 'true' ? true : scalar('partial') === 'false' ? false : undefined,
  };
}
