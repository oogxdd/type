import { randomUUID } from 'node:crypto';
import { joinFrontmatter, readFrontmatterScalar, splitFrontmatter, upsertFrontmatterScalar } from '@typenotes/shared/frontmatter';
import { NOTE_UUID_PATTERN, NOTE_REVISION_PATTERN, type SourceDependency } from '@typenotes/shared/note-reference';
import { projectNote, ProjectionError } from './projection';

export function validDocumentMoment(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2})))?$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value)) || new Date(match[1]).toISOString().slice(0,10) !== match[1]) return false;
  return !match[2] || Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59 &&
    (!match[5] || Number(match[5]) <= 23 && Number(match[6]) <= 59);
}

/** Add service fields while retaining user metadata and protecting document identity. */
export function documentMarkdown(markdown: string, fields: Record<string, string> = {}, original?: string): string {
  markdown = markdown.replace(/^\uFEFF/, '');
  projectNote(markdown);
  if (original && !splitFrontmatter(markdown).frontmatterBlock) {
    markdown = joinFrontmatter(splitFrontmatter(original).frontmatterBlock, markdown);
  }
  const priorId = original ? readFrontmatterScalar(original, 'id') : null;
  const proposedId = readFrontmatterScalar(markdown, 'id');
  if (priorId && proposedId && priorId !== proposedId) throw new ProjectionError('Document identity cannot be changed.');
  const id = priorId ?? proposedId ?? randomUUID();
  if (!NOTE_UUID_PATTERN.test(id)) throw new ProjectionError('Memory id must be a valid UUID; correct legacy metadata explicitly.');
  const header = splitFrontmatter(markdown).frontmatterBlock ?? '';
  for (const key of ['id', ...Object.keys(fields)]) {
    if (header.split('\n').filter(line => new RegExp('^\\s*' + key + '\\s*:').test(line)).length > 1) throw new ProjectionError('Duplicate service metadata field.');
  }
  for (const [key, value] of Object.entries({...fields, id})) markdown = upsertFrontmatterScalar(markdown, key, value);
  return markdown;
}

/** Parse only the documented dependency fields; never expose arbitrary frontmatter. */
export function sourceDependencies(raw: string): SourceDependency[] | null {
  const value = readFrontmatterScalar(raw, 'sources_json');
  if (value === null) return [];
  try {
    const items: unknown = JSON.parse(value);
    if (!Array.isArray(items) || items.length > 1000) return null;
    const result: SourceDependency[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !NOTE_UUID_PATTERN.test(item.id) ||
          typeof item.revision !== 'string' || !NOTE_REVISION_PATTERN.test(item.revision) ||
          (item.role !== undefined && !['evidence', 'context'].includes(item.role))) return null;
      result.push({id: item.id.toLowerCase(), revision: item.revision, role: item.role ?? 'evidence'});
    }
    return result;
  } catch { return null; }
}
