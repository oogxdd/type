import { JSDOM } from 'jsdom';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMParser, type Node } from '@tiptap/pm/model';
import { markdownToHtml } from '@typenotes/note-document/markdown';
import { TagBlock, TagSpan } from '@typenotes/note-document/tagged-blocks';
import { stripInlineAnnotationMetadata } from '@typenotes/shared/annotation-metadata';
import { splitFrontmatter } from '@typenotes/shared/frontmatter';
import { parseTagAttrs, tagKey, validTagName } from '@typenotes/shared/tags';
import { parseNoteReference, formatNoteReference, type DocumentProjection } from '@typenotes/shared/note-reference';

// No scripts or external resources are enabled when parsing private notes.
const dom = new JSDOM('');
// Memory files may use every Markdown heading level; tag semantics match the editor.
const schema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: {protocols: ['type-note']} }), TagBlock, TagSpan]);
export class ProjectionError extends Error {}

/** Privacy seam. Keep this schema aligned with the desktop body-tag schema.
 * Tags are Markdown syntax: leading runs, containers and spans. Mid-line
 * hashtags remain prose. No registry lookup is required to hide private text.
 */
export function projectNote(raw: string): string {
  return projectDocument(raw).content;
}

export function projectDocument(raw: string): DocumentProjection {
  const output: DocumentProjection = {content: '', outline: [], links: []};
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
    if (names.some(name => tagKey(name) === 'skip-ai')) return output;
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
  let line = 1;
  let inlineNewlines = 0;
  const visibleInline = (node: Node): string => {
    if (node.marks.some(mark => mark.type.name === 'tagSpan' && privateNames(mark.attrs.tags))) return '';
    if (node.isText) {
      const text = node.text ?? '';
      const href = node.marks.find(mark => mark.type.name === 'link')?.attrs.href;
      const reference = typeof href === 'string' ? parseNoteReference(href) : null;
      if (reference && text) output.links.push({uri: formatNoteReference(reference), label: text, line: line + inlineNewlines});
      inlineNewlines += text.split('\n').length - 1;
      return text;
    }
    if (node.type.name === 'hardBreak') { inlineNewlines++; return '\n'; }
    let text = ''; node.forEach(child => { text += visibleInline(child); }); return text;
  };
  const blocks: string[] = [];
  const anchors = new Set<string>();
  const nextSuffix = new Map<string, number>();
  const visit = (node: Node) => {
    if (node.type.name === 'tagBlock' && privateNames(node.attrs.tags)) return;
    if (node.isTextblock) {
      inlineNewlines = 0;
      const text = visibleInline(node);
      if (!text) return;
      if (node.type.name === 'heading') {
        const base = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 450) || 'section';
        let anchor = base;
        let number = nextSuffix.get(base) ?? 2;
        while (anchors.has(anchor)) anchor = base + '-' + number++;
        nextSuffix.set(base, number);
        anchors.add(anchor);
        output.outline.push({anchor, level: node.attrs.level, title: text, startLine: line, endLine: line});
      }
      blocks.push(text);
      line += text.split('\n').length + 1;
      return;
    }
    node.forEach(visit);
  };
  visit(doc);
  output.content = blocks.join('\n\n');
  const totalLines = output.content ? output.content.split('\n').length : 0;
  const open: DocumentProjection['outline'] = [];
  for (const heading of output.outline) {
    while (open.length && open[open.length - 1].level >= heading.level) open.pop()!.endLine = heading.startLine - 1;
    open.push(heading);
  }
  for (const heading of open) heading.endLine = totalLines;
  // External URLs, arbitrary attributes, raw metadata and filenames stay excluded.
  return output;
}
