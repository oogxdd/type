import { constants } from 'node:fs';
import { lstat, realpath, mkdir, open, readdir, rename, unlink, rmdir, link } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { projectNote, ProjectionError } from './projection';

const MAX_BYTES = 1024 * 1024;
const revision = (raw: string) => createHash('sha256').update(raw).digest('hex');
const fail = (message: string): never => { throw new ProjectionError(message); };
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** The agent folder's location inside a notes root, as path segments. */
const AGENT_PREFIX = ['_system', 'agent'] as const;

/** Write boundary is always <configured notes root>/_system/agent; clients cannot choose it.
 * No user path is passed to fs until every component has been validated.
 * As with the read repository, this does not sandbox hostile concurrent OS processes.
 * Line-tag migration belongs in projection.ts, not in this filesystem boundary.
 */
export class AgentWorkspace {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private notesRoot: string) {}
  private parts(path: string, allowRoot = false): string[] {
    if (path === '' && allowRoot) return [];
    const parts = path.split('/');
    if (path.length > 1024 || parts.length > 64 || parts.some(part => !part || part.startsWith('.') || /[\\:\x00-\x1f\x7f]/.test(part) || /[. ]$/.test(part))) {
      fail('Use a relative path inside agent, without dot entries, backslashes or parent traversal.');
    }
    return parts;
  }
  private async path(path: string, createParents = false, allowRoot = false) {
    const parts = this.parts(path, allowRoot);
    if (await realpath(this.notesRoot) !== this.notesRoot) fail('Notes root changed.');
    let current = this.notesRoot;
    const segments = [...AGENT_PREFIX, ...parts];
    for (const [index, part] of segments.entries()) {
      current = join(current, part);
      const parent = index < segments.length - 1;
      let stat;
      try { stat = await lstat(current); }
      catch (error) {
        if (!missing(error)) throw error;
        // The prefix is ours to create even when it is the requested entry.
        if (createParents && (parent || index < AGENT_PREFIX.length)) { await mkdir(current); stat = await lstat(current); }
        // A missing prefix segment means nothing below it exists either, so
        // hand back the full target and let the caller's own open/readdir
        // report it — that is what makes list('') on a fresh root empty.
        else if (!parent || index < AGENT_PREFIX.length) return join(this.notesRoot, ...segments);
        else throw error;
      }
      if (stat.isSymbolicLink() || await realpath(current) !== current) fail('Links are not allowed inside agent.');
      if (parent && !stat.isDirectory()) fail('Parent is not a folder.');
      if (stat.isFile() && stat.nlink !== 1) fail('Hard links are not allowed inside agent.');
    }
    return current;
  }
  private note(path: string) { this.parts(path); if (!path.toLowerCase().endsWith('.md')) fail('Note paths must end with .md.'); }
  private content(content: string) { if (Buffer.byteLength(content) > MAX_BYTES) fail('Note exceeds 1 MiB.'); }
  // Serialize this server's reads and writes, including revision checks and moves.
  async run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  private async raw(path: string) {
    this.note(path);
    const full = await this.path(path);
    const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BYTES) fail('Note unavailable.');
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const {bytesRead} = await handle.read(buffer, length, buffer.length-length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_BYTES) fail('Note exceeds 1 MiB.');
      const after = await handle.stat();
      await this.path(path);
      const current = await lstat(full);
      if (before.ino !== current.ino || before.dev !== current.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size) fail('Note changed; read again.');
      return new TextDecoder('utf-8', {fatal:true}).decode(buffer.subarray(0,length));
    } finally { await handle.close(); }
  }
  async read(path: string) {
    const raw = await this.raw(path);
    return {path, content: projectNote(raw), revision: revision(raw)};
  }
  async list(path = '') {
    const full = await this.path(path, false, true);
    let entries;
    try { entries = await readdir(full, {withFileTypes:true}); }
    catch (error) { if (path === '' && missing(error)) return {entries:[]}; throw error; }
    if (entries.length > 10_000) fail('Folder has too many entries.');
    return {entries: entries.filter(entry => !entry.name.startsWith('.') && !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile() && entry.name.toLowerCase().endsWith('.md')))
      .sort((a,b)=>a.name.localeCompare(b.name)).map(entry=>({path: path ? `${path}/${entry.name}` : entry.name, kind:entry.isDirectory()?'folder':'note'}))};
  }
  async createFolder(path: string) {
    const full = await this.path(path, true);
    try { await mkdir(full); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await lstat(full)).isDirectory()) throw error; }
    return {path};
  }
  async createNote(path: string, content: string) {
    this.note(path); this.content(content);
    const full = await this.path(path, true);
    const handle = await open(full, 'wx', 0o600);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    return {path, revision: revision(content)};
  }
  async updateNote(path: string, content: string, expectedRevision: string) {
    this.content(content);
    const original = await this.raw(path);
    if (revision(original) !== expectedRevision) fail('Revision conflict; read the note again.');
    // Full replacement is explicitly authorized only inside agent. This replaces
    // frontmatter/tags too; do not reuse this method for user-owned notes elsewhere.
    const full = await this.path(path);
    const temporary = join(dirname(full), `.agent-write-${randomUUID()}`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close();
      if (revision(await this.raw(path)) !== expectedRevision) fail('Revision conflict; read the note again.');
      await rename(temporary, full);
    } finally { await handle.close().catch(()=>{}); await unlink(temporary).catch(()=>{}); }
    return {path, revision: revision(content)};
  }
  async move(source: string, destination: string, kind: 'note' | 'folder') {
    if (kind === 'note') { this.note(source); this.note(destination); }
    const from = await this.path(source);
    if (destination.startsWith(`${source}/`)) fail('Cannot move a folder into itself.');
    const stat = await lstat(from);
    if (kind === 'note' ? !stat.isFile() : !stat.isDirectory()) fail('Wrong entry type.');
    const to = await this.path(destination, true);
    try { await lstat(to); fail('Destination already exists.'); } catch (error) { if (!missing(error)) throw error; }
    if (kind === 'note') { await link(from,to); await unlink(from); }
    else { await this.scanFolder(source); await rename(from,to); }
    return {path:destination};
  }
  private async scanFolder(path: string): Promise<{files: string[]; folders: string[]}> {
    const files: string[] = [], folders: string[] = [];
    let count = 0;
    const walk = async (relative: string) => {
      const full = await this.path(relative);
      for (const entry of await readdir(full,{withFileTypes:true})) {
        if (++count > 10_000) fail('Folder operation exceeds 10000 entries.');
        const child = `${relative}/${entry.name}`;
        await this.path(child);
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile()) { this.note(child); files.push(child); }
        else fail('Folder contains an unsupported entry.');
      }
      folders.push(relative);
    };
    await walk(path); return {files,folders};
  }
  async deleteNote(path: string) {
    this.note(path); const full = await this.path(path);
    if (!(await lstat(full)).isFile()) fail('Not a note.');
    await unlink(full); return {deleted:path};
  }
  async deleteFolder(path: string, recursive: boolean) {
    const full = await this.path(path);
    if (recursive) {
      const entries = await this.scanFolder(path);
      for (const file of entries.files) await this.deleteNote(file);
      for (const folder of entries.folders) await rmdir(await this.path(folder));
    } else await rmdir(full);
    return {deleted:path};
  }
}
