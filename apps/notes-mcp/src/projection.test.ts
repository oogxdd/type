import { describe, expect, it } from 'vitest';
import { projectNote } from './projection';
describe('body-tag AI projection', () => {
  it('note-wide skip-ai hides the complete note', () => { expect(projectNote('---\ntags: [todo, skip-ai]\n---\nCANARY')).toBe(''); expect(projectNote('---\ntags: [todo]\n---\nVisible')).toBe('Visible'); });
  it('leading hashtags and containers are tags; mid-line hashtags are prose', () => {
    expect(projectNote('Visible #skip-ai\n\n#skip-ai CANARY\n\n::: #skip-ai\nCANARY\n:::\n\n#work Last')).toBe('Visible #skip-ai\n\nLast');
  });
  it('hides whole subtrees including headings, lists, code and nested containers', () => {
    expect(projectNote('Visible\n\n:::: #skip-ai\n# Header\n\n- CANARY\n\n```js\nCANARY\n```\n\n::: #work\nCANARY\n:::\n::::\n\nEnd')).toBe('Visible\n\nEnd');
  });
  it('hides spans within formatted text and lists, stripping all tag syntax', () => {
    expect(projectNote('- safe [**CANARY** 😀]{#SKIP-AI}\n- [visible]{#work number=42}')).toBe('safe \n\nvisible');
  });
  it('text edits and duplicate paragraphs do not detach privacy', () => {
    expect(projectNote('new\n\n::: #skip-ai\nchanged\n\nsame\n:::\n\nsame')).toBe('new\n\nsame');
  });
  it('unterminated private containers extend to end of body', () => {
    expect(projectNote('visible\n\n::: #skip-ai\nCANARY\n\nlast')).toBe('visible');
    expect(projectNote(':::: #work\nvisible\n\n::: #skip-ai\nCANARY')).toBe('visible');
  });
  it('an outer closer cannot narrow an unterminated private child', () => { expect(projectNote(':::: #work\nvisible\n\n::: #skip-ai\nCANARY\n::::\nAFTER_CANARY')).toBe('visible'); });
  it('withholds malformed openers, attributes and encrypted notes', () => {
    for (const body of ['::: #bad!!\nCANARY', '::: #skip-ai x="unfinished\nCANARY', ':::#bad!!\nCANARY', '---\nsecret: CANARY', '---\nid: x\n---\nNV_ENC_V1:CANARY']) expect(() => projectNote(body)).toThrow();
  });
  it('nested public spans cannot override an enclosing private span', () => { expect(projectNote('[outer [CANARY]{#work}]{#skip-ai}')).toBe(''); });
  it('a leading tag paragraph cannot swallow a following privacy opener', () => { expect(projectNote('#work visible\n::: #skip-ai\nCANARY\n:::')).toBe('visible'); expect(projectNote('#work visible\n#skip-ai CANARY')).toBe('visible'); });
  it('keeps tags inside code literal', () => {
    expect(projectNote('```\n#skip-ai literal\n```')).toContain('#skip-ai literal');
  });
  it('never returns metadata, annotation copies, comments or link targets', () => {
    expect(projectNote('---\ntitle: CANARY\n---\n[Visible](https://CANARY)\n\ntype_annotations_b64: Q0FOQVJZQ0FOQVJZ\n\n<!-- type:lens:v1\n{"text":"CANARY"}\n-->')).toBe('Visible');
  });
  it('handles CRLF and blank editor paragraphs inside private ranges', () => {
    expect(projectNote('before\r\n\r\n::: #skip-ai\r\n\r\n\r\n\r\nCANARY\r\n:::\r\n\r\nafter')).toBe('before\n\nafter');
  });
});
