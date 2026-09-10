import { AgentWorkspace } from './agent-workspace';
import { constants } from 'node:fs';
import { lstat, realpath, readdir, open } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectNote, ProjectionError } from './projection';

const MAX_BYTES = 1024 * 1024;
const excluded = new Set(['Recordings', 'Attachments', '_Recordings']);
export class NotesRepository {
  private paths = new Map<string, string>();
  private ids = new Map<string, string>();
  readonly agent: AgentWorkspace;
  private constructor(private root: string) { this.agent = new AgentWorkspace(root); }
  static async create(root: string) {
    if (!isAbsolute(root)) throw new Error('Use an absolute notes-root path.');
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw new Error('Notes root must be a directory.');
    return new NotesRepository(canonical);
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
  async inventory(): Promise<string[]> {
    const result: string[] = [];
    let visited = 0;
    const walk = async (dir: string, depth: number) => {
      if (depth > 64) throw new Error('Folder depth limit exceeded.');
      if (dir !== this.root) await this.checked(dir);
      else if (await realpath(dir) !== this.root) throw new Error('Notes root changed.');
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        if (++visited > 100_000) throw new Error('Folder entry limit exceeded.');
        if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.isSymbolicLink()) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          let id = this.ids.get(path);
          if (!id) { id = randomUUID(); this.ids.set(path, id); this.paths.set(id, path); }
          result.push(id);
        }
      }
    };
    await walk(this.root, 0);
    return result;
  }
  async read(id: string) {
    const path = this.paths.get(id);
    if (!path) throw new ProjectionError('Unknown note ID. Call list_notes first.');
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
    return { id, content: projectNote(raw) };
  }
  async list(query?: string, cursor = 0, limit = 25) {
    const ids = await this.inventory();
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > ids.length) throw new ProjectionError('Invalid cursor; restart listing.');
    const notes: {id: string; preview: string}[] = [];
    let unavailableCount = 0;
    let next = cursor;
    for (const id of ids.slice(cursor, cursor + 200)) {
      next++;
      try {
        const note = await this.read(id);
        const lines = note.content.split('\n');
        const line = query === undefined ? lines.find(line => line.trim()) ?? '' : lines.find(line => line.toLowerCase().includes(query.toLowerCase()));
        if (line !== undefined) notes.push({ id, preview: [...line].slice(0, 240).join('') });
      } catch { unavailableCount++; }
      if (notes.length >= limit) break;
    }
    return { notes, nextCursor: next < ids.length ? String(next) : null, unavailableCount };
  }
}
