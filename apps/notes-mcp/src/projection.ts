import { JSDOM } from 'jsdom';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMParser } from '@tiptap/pm/model';
import { markdownToHtml } from '@typenotes/note-document/markdown';
import { TaggedBlocks, documentBlocks } from '@typenotes/note-document/tagged-blocks';
import { stripInlineAnnotationMetadata } from '@typenotes/shared/annotation-metadata';
import { splitFrontmatter, readFrontmatterScalar } from '@typenotes/shared/frontmatter';
import { resolveBlockAnchor, tagKey, validTag, type TaggedBlock } from '@typenotes/shared/selection-tags';

// No scripts or external resources are enabled in this DOM. Never use a browser
// or JSDOM's resources/runScripts options to parse private notes.
const dom = new JSDOM('');
const schema = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] } }), TaggedBlocks]);
export class ProjectionError extends Error {}

/** Migration seam: a v2 body-line implementation belongs here, not in MCP tools.
 * Keep the same fail-closed contract for malformed/stale/ambiguous private tags.
 * Uses the editor's exact Markdown conversion, schema and anchor resolver for v1.
 */
export function projectNote(raw: string): string {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const { frontmatterBlock, body } = splitFrontmatter(normalized);
  if (normalized.startsWith('---\n') && !frontmatterBlock) throw new ProjectionError('Malformed frontmatter; note withheld.');
  if (body.trimStart().startsWith('NV_ENC_V1:')) throw new ProjectionError('Encrypted note; this standalone server has no unlock key.');
  const declarations = frontmatterBlock?.split('\n').filter(line => /^\s*type_selection_tags\s*:/.test(line)) ?? [];
  let saved: TaggedBlock[] = [];
  if (declarations.length) {
    try {
      if (declarations.length !== 1) throw new Error();
      const value = readFrontmatterScalar(normalized, 'type_selection_tags');
      if (!value) throw new Error();
      const payload = JSON.parse(value);
      if (payload.version !== 1 || !Array.isArray(payload.blocks)) throw new Error();
      saved = payload.blocks;
      for (const entry of saved) {
        if (!entry || !Number.isInteger(entry.index) || entry.index < 0 || typeof entry.hash !== 'string'
          || typeof entry.before !== 'string' || typeof entry.after !== 'string'
          || (entry.document !== undefined && typeof entry.document !== 'string')
          || !Array.isArray(entry.tags) || !entry.tags.every(validTag)) throw new Error();
      }
    } catch { throw new ProjectionError('Invalid or unsupported tag metadata; note withheld.'); }
  }
  const container = dom.window.document.createElement('div');
  container.innerHTML = markdownToHtml(stripInlineAnnotationMetadata(body));
  const doc = DOMParser.fromSchema(schema).parse(container);
  const blocks = documentBlocks(doc);
  const anchors = blocks.map(block => block.anchor);
  const hidden = new Set<number>();
  for (const entry of saved.filter(entry => entry.tags.some(tag => tagKey(tag.name) === 'skip-ai'))) {
    const index = resolveBlockAnchor(entry, anchors);
    if (index === null) throw new ProjectionError('Cannot resolve a skip-ai tag; note withheld.');
    hidden.add(index);
  }
  // Plain text intentionally excludes ALL metadata, link URLs, filenames and HTML
  // attributes. Do not serialize the original document after hiding only node text.
  // Literal '#skip-ai' in prose has no special meaning: only assigned tags count.
  return blocks.filter((_, index) => !hidden.has(index))
    .map(({ node }) => node.textBetween(0, node.content.size, '\n', '\n')).join('\n\n');
}
