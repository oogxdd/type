/** Logical links are relative to the selected notes root, never filesystem URLs. */
export const NOTE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOTE_REVISION_PATTERN = /^[a-f0-9]{64}$/;

export type NoteReference = {
  id: string;
  revision?: string;
  heading?: string;
  startLine?: number;
  endLine?: number;
};

export type SourceDependency = {
  id: string;
  revision: string;
  /** Omitted by older clients; equivalent to evidence. */
  role?: 'evidence' | 'context';
};

export type DocumentHeading = {
  anchor: string;
  level: number;
  title: string;
  startLine: number;
  endLine: number;
};

export type DocumentLink = { uri: string; label: string; line: number };
export type DocumentProjection = {
  content: string;
  outline: DocumentHeading[];
  links: DocumentLink[];
};

function validReference(ref: NoteReference): boolean {
  if (!NOTE_UUID_PATTERN.test(ref.id) || (ref.revision !== undefined && !NOTE_REVISION_PATTERN.test(ref.revision))) return false;
  if (ref.heading !== undefined && (!ref.heading || ref.heading.length > 512 || /[\x00-\x1f\x7f]/.test(ref.heading))) return false;
  const hasRange = ref.startLine !== undefined || ref.endLine !== undefined;
  return !hasRange || Boolean(ref.revision && ref.heading === undefined &&
    Number.isSafeInteger(ref.startLine) && Number.isSafeInteger(ref.endLine) &&
    ref.startLine! >= 1 && ref.endLine! >= ref.startLine!);
}

export function formatNoteReference(ref: NoteReference): string {
  if (!validReference(ref)) throw new Error('Invalid note reference.');
  const query = ref.revision ? '?revision=' + ref.revision : '';
  const target = ref.heading !== undefined ? '#heading=' + encodeURIComponent(ref.heading)
    : ref.startLine !== undefined ? '#L' + ref.startLine + '-L' + ref.endLine : '';
  return 'type-note://' + ref.id.toLowerCase() + query + target;
}

/** Strict allowlist: no filenames, arbitrary query parameters or external URLs. */
export function parseNoteReference(uri: string): NoteReference | null {
  if (uri.length > 4096) return null;
  const match = /^type-note:\/\/([0-9a-f-]{36})(?:\?revision=([a-f0-9]{64}))?(?:#(?:heading=([^#?]+)|L([0-9]+)-L([0-9]+)))?$/i.exec(uri);
  if (!match) return null;
  try {
    const ref: NoteReference = {id: match[1].toLowerCase()};
    if (match[2]) ref.revision = match[2];
    if (match[3]) ref.heading = decodeURIComponent(match[3]);
    if (match[4]) { ref.startLine = Number(match[4]); ref.endLine = Number(match[5]); }
    return validReference(ref) ? ref : null;
  } catch { return null; }
}
