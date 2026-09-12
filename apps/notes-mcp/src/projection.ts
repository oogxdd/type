import { JSDOM } from 'jsdom';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMParser, type Node } from '@tiptap/pm/model';
import { markdownToHtml } from '@typenotes/note-document/markdown';
import { TagBlock, TagSpan } from '@typenotes/note-document/tagged-blocks';
import { stripInlineAnnotationMetadata } from '@typenotes/shared/annotation-metadata';
import { splitFrontmatter } from '@typenotes/shared/frontmatter';
import { parseTagAttrs, tagKey, validTagName } from '@typenotes/shared/tags';

// No scripts or external resources are enabled when parsing private notes.
const dom = new JSDOM('');
const schema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } }), TagBlock, TagSpan]);
export class ProjectionError extends Error {}

/** Privacy seam. Keep this schema aligned with the desktop body-tag schema.
 * Tags are Markdown syntax: leading runs, containers and spans. Mid-line
 * hashtags remain prose. No registry lookup is required to hide private text.
 */
export function projectNote(raw: string): string {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const { frontmatterBlock, body } = splitFrontmatter(normalized);
  if (normalized.startsWith('---\n') && !frontmatterBlock) throw new ProjectionError('Malformed frontmatter; note withheld.');
  if (body.trimStart().startsWith('NV_ENC_V1:')) throw new ProjectionError('Encrypted note; this standalone server has no unlock key.');
  // Conservative even for malformed fence-looking lines in code or HTML: a
  // parser fallback must never turn a possibly private scope into visible prose.
  for (const line of body.split('\n')) {
    const opener = /^\s*(?:>\s*)*(:{3,})[ \t]*(.*)$/.exec(line);
    if (opener && opener[2].trim() && !parseTagAttrs(opener[2])) throw new ProjectionError('Invalid tag container; note withheld.');
  }
  const noteTagLines = frontmatterBlock?.split('\n').filter(line => /^\s*tags\s*:/i.test(line)) ?? [];
  if (noteTagLines.length) {
    if (noteTagLines.length !== 1) throw new ProjectionError('Duplicate note tags; note withheld.');
    const value = noteTagLines[0].slice(noteTagLines[0].indexOf(':') + 1).trim();
    let names: unknown;
    try { names = JSON.parse(value); }
    catch {
      if (!value.startsWith('[') || !value.endsWith(']')) throw new ProjectionError('Invalid note tags; note withheld.');
      names = value.slice(1, -1).split(',').map(name => name.trim().replace(/^'|'$/g, '')).filter(Boolean);
    }
    if (!Array.isArray(names) || !names.every(validTagName)) throw new ProjectionError('Invalid note tags; note withheld.');
    if (names.some(name => tagKey(name) === 'skip-ai')) return '';
  }
  const container = dom.window.document.createElement('div');
  container.innerHTML = markdownToHtml(stripInlineAnnotationMetadata(body));
  if (container.querySelector('[data-tag-invalid]')) throw new ProjectionError('Invalid tag container; note withheld.');
  // Raw pasted HTML also uses the shared seam; invalid attributes fail closed.
  for (const element of container.querySelectorAll('[data-tag-attrs]')) {
    if (!parseTagAttrs(element.getAttribute('data-tag-attrs') ?? '')) throw new ProjectionError('Invalid tag attributes; note withheld.');
  }
  const doc = DOMParser.fromSchema(schema).parse(container);
  const privateNames = (names: string[]) => names.some(name => tagKey(name) === 'skip-ai');
  const visibleInline = (node: Node): string => {
    if (node.marks.some(mark => mark.type.name === 'tagSpan' && privateNames(mark.attrs.tags))) return '';
    if (node.isText) return node.text ?? '';
    if (node.type.name === 'hardBreak') return '\n';
    let text = ''; node.forEach(child => { text += visibleInline(child); }); return text;
  };
  const blocks: string[] = [];
  const visit = (node: Node) => {
    if (node.type.name === 'tagBlock' && privateNames(node.attrs.tags)) return;
    if (node.isTextblock) { const text = visibleInline(node); if (text) blocks.push(text); return; }
    node.forEach(visit);
  };
  visit(doc);
  // ALL metadata, URLs, HTML attributes and filenames are excluded from output.
  return blocks.join('\n\n');
}
