import { describe, expect, it } from 'vitest';
import { blockAnchors, writeSelectionTags } from '@typenotes/shared/selection-tags';
import { projectNote } from './projection';

const tag = { name: 'skip-ai', color: '#8b5cf6' };
function tagged(body: string, texts: string[], indices: number[]) {
  const anchors = blockAnchors(texts);
  return writeSelectionTags(body, indices.map(index => ({ ...anchors[index], tags: [tag] })));
}
describe('v1 selection-tag AI projection', () => {
  it('hides assigned blocks, not literal hashtags or other custom tags', () => {
    const body = 'Visible #skip-ai\n\nCANARY\n\nLast';
    const raw = tagged(body, ['Visible #skip-ai', 'CANARY', 'Last'], [1]);
    expect(projectNote(raw)).toBe('Visible #skip-ai\n\nLast');
    expect(projectNote(raw.replace('"name":"skip-ai"', '"name":"work"'))).toContain('CANARY');
  });
  it('matches headings, lists, formatted text, Unicode, hard breaks and code', () => {
    const body = '# Visible\n\n- **Секрет** 😀\n- safe\n\nline one\nline two\n\n```js\nCANARY\ncode\n```\n\nEnd';
    const raw = tagged(body, ['Visible', 'Секрет 😀', 'safe', 'line one\nline two', 'CANARY\ncode\n', 'End'], [1, 3, 4]);
    expect(projectNote(raw)).toBe('Visible\n\nsafe\n\nEnd');
  });
  it('resolves an insertion above the private block', () => {
    const raw = tagged('before\n\nCANARY\n\nafter', ['before','CANARY','after'], [1]);
    expect(projectNote(raw.replace('\nbefore', '\nnew\n\nbefore'))).toBe('new\n\nbefore\n\nafter');
  });
  it('withholds stale and ambiguous private tags', () => {
    const raw = tagged('CANARY', ['CANARY'], [0]);
    expect(() => projectNote(raw.replace(/\nCANARY$/, '\nchanged'))).toThrow('Cannot resolve');
    expect(() => projectNote(raw.replace(/\nCANARY$/, '\nx\n\nCANARY\n\nx\n\nCANARY\n\nx'))).toThrow('Cannot resolve');
  });
  it('withholds invalid, unsupported, duplicate metadata and encrypted notes', () => {
    for (const value of ['broken', '{"version":2,"blocks":[]}', '{"version":1,"blocks":[{}]}']) {
      expect(() => projectNote(`---\ntype_selection_tags: ${value}\n---\nCANARY`)).toThrow();
    }
    expect(() => projectNote('---\ntype_selection_tags: {}\ntype_selection_tags: {}\n---\nCANARY')).toThrow();
    expect(() => projectNote('---\nsecret: CANARY')).toThrow();
    expect(() => projectNote('---\nid: x\n---\nNV_ENC_V1:CANARY')).toThrow();
  });
  it('never returns frontmatter, annotation copies, comments or link targets', () => {
    const raw = '---\ntitle: CANARY\n---\n[Visible](https://CANARY)\n\ntype_annotations_b64: Q0FOQVJZQ0FOQVJZ\n\n<!-- type:lens:v1\n{"text":"CANARY"}\n-->';
    expect(projectNote(raw)).toBe('Visible');
  });
  it('handles CRLF and blank editor paragraphs', () => {
    const raw = tagged('before\n\n\n\nCANARY\n\nafter', ['before','','CANARY','after'], [2]);
    expect(projectNote(raw.replace(/\n/g,'\r\n'))).not.toContain('CANARY');
  });
});
