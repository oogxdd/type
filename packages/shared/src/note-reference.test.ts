import { describe, expect, it } from 'vitest';
import { formatNoteReference, parseNoteReference } from './note-reference';

const id = '12345678-1234-4234-8234-123456789012';
const revision = 'a'.repeat(64);

describe('portable note links', () => {
  it('roundtrips document, Unicode heading and pinned fragment links', () => {
    for (const ref of [{id}, {id, heading:'отношения-и-работа-2'}, {id, revision, startLine:3, endLine:7}, {id, revision, heading:'first'}]) {
      expect(parseNoteReference(formatNoteReference(ref))).toEqual(ref);
    }
  });
  it('rejects external URLs, paths, extra parameters, malformed encoding and unpinned ranges', () => {
    for (const uri of ['https://example.test', 'type-note://../../secret',
      'type-note://' + id + '?path=secret', 'type-note://' + id + '#heading=%ZZ',
      'type-note://' + id + '#heading=%0Asecret', 'type-note://' + id + '#L1-L2',
      'type-note://' + id + '?revision=' + revision + '#L8-L2',
      'type-note://' + id + '?revision=' + revision + '#L1-L9007199254740992']) {
      expect(parseNoteReference(uri)).toBeNull();
    }
  });
  it('requires a single valid selector when formatting', () => {
    expect(() => formatNoteReference({id, startLine:1,endLine:2})).toThrow();
    expect(() => formatNoteReference({id, revision, heading:'title', startLine:1,endLine:2})).toThrow();
  });
});
