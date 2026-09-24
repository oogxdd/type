import { formatNoteReference, parseNoteReference, type NoteReference } from '@typenotes/shared/note-reference';
import { NotesRepository, type SourceNote } from './repository';
import { ProjectionError } from './projection';

export type DocumentSelection = {heading?: string; startLine?: number; endLine?: number};

function select(note: SourceNote, selection: DocumentSelection = {}) {
  const allLines = note.content.split('\n');
  const hasRange = selection.startLine !== undefined || selection.endLine !== undefined;
  if (selection.heading !== undefined && hasRange) throw new ProjectionError('Choose a heading or a line range.');
  const heading = selection.heading !== undefined ? note.outline.find(item => item.anchor === selection.heading) : undefined;
  if (selection.heading !== undefined && !heading) throw new ProjectionError('Document target unavailable.');
  const startLine = heading?.startLine ?? selection.startLine ?? 1;
  const endLine = heading?.endLine ?? selection.endLine ?? (hasRange ? startLine : allLines.length);
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > allLines.length) {
    throw new ProjectionError('Line range is outside the permitted document.');
  }
  const lines = allLines.slice(startLine - 1, endLine).map((text, index) => ({number: startLine + index, text}));
  return {startLine, endLine, content: lines.map(line => line.text).join('\n'), lines};
}

export class References {
  constructor(private repository: NotesRepository) {}

  async readDocument(id: string, selection: DocumentSelection = {}) {
    const note = await this.repository.read(id);
    return {...note, ...select(note, selection)};
  }

  async create(id: string, kind: 'navigation' | 'citation', selection: DocumentSelection = {}, expectedRevision?: string) {
    const note = await this.repository.read(id);
    if (!note.metadata.portable) throw new ProjectionError('A portable reference requires a unique frontmatter UUID in this area.');
    if (kind === 'citation' && !expectedRevision) throw new ProjectionError('Citations require the revision returned by reading the source.');
    if (expectedRevision && note.revision !== expectedRevision) throw new ProjectionError('Source changed; read it again before citing.');
    if (kind === 'navigation' && (selection.startLine !== undefined || selection.endLine !== undefined)) {
      throw new ProjectionError('Line ranges require a citation; navigation targets documents or headings.');
    }
    const target = select(note, selection);
    const reference: NoteReference = {id: note.id};
    if (kind === 'citation') reference.revision = note.revision;
    if (selection.heading !== undefined) reference.heading = selection.heading;
    else if (selection.startLine !== undefined || selection.endLine !== undefined) {
      reference.startLine = target.startLine;
      reference.endLine = target.endLine;
    }
    return {uri: formatNoteReference(reference), reference, ...target};
  }

  async resolve(uri: string) {
    const reference = parseNoteReference(uri);
    if (!reference) throw new ProjectionError('Invalid note reference.');
    let note: SourceNote;
    try { note = await this.repository.read(reference.id); }
    catch { return {status: 'unavailable' as const}; }
    if (!note.metadata.portable) return {status: 'unavailable' as const};
    if (reference.revision && reference.revision !== note.revision) {
      return {status: 'changed' as const, current: {id: note.id, uri: note.uri, revision: note.revision}};
    }
    try {
      return {status: 'ok' as const, document: {...note, ...select(note, reference)}};
    } catch {
      return {status: 'target_unavailable' as const, current: {id: note.id, uri: note.uri, revision: note.revision}};
    }
  }

  /** Check direct edges. The caller can follow derived dependencies for deeper review. */
  async checkDependencies(id: string) {
    const document = await this.repository.read(id);
    const dependencies = [];
    for (const source of document.metadata.sources) {
      try {
        const current = await this.repository.read(source.id, false);
        dependencies.push({...source, status: current.revision === source.revision ? 'current' : 'changed', currentRevision: current.revision, kind: current.metadata.kind});
      } catch { dependencies.push({...source, status: 'unavailable'}); }
    }
    return {id: document.id, revision: document.revision, dependencies,
      status: document.metadata.dependenciesUnavailable ? 'unknown' : dependencies.some(source => source.status !== 'current') ? 'stale' : 'current',
      directOnly: true};
  }
}
