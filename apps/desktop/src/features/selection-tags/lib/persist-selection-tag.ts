import { DOMParser } from "@tiptap/pm/model";
import { readNote, writeNote } from "@/features/notes/api/notes-api";
import { markdownToHtml } from "@/features/notes/editor/lib/markdown-editor";
import { stripInlineAnnotationMetadata } from "@typenotes/shared/annotation-metadata";
import { stripFrontmatter } from "@typenotes/shared/frontmatter";
import { mergeTag, readSelectionTags, resolveBlockAnchor, writeSelectionTags, type SelectionTag, type TaggedBlock } from "@typenotes/shared/selection-tags";
import { documentBlocks } from "./tagged-blocks";
import { isTagSurfaceCurrent, type CapturedTagSelection } from "./selection-surfaces";

/** Review only changes metadata; the source body remains byte-for-byte intact
 * apart from the frontmatter utility's existing CRLF normalization. */
export async function persistReviewTag(selection: CapturedTagSelection, tag: SelectionTag): Promise<string> {
  if (!isTagSurfaceCurrent(selection.surface)) throw new Error("The note changed. Select the text again.");
  const raw = await readNote(selection.surface.path);
  if (!isTagSurfaceCurrent(selection.surface)) throw new Error("The note changed. Select the text again.");
  const container = document.createElement("div");
  container.innerHTML = markdownToHtml(stripInlineAnnotationMetadata(stripFrontmatter(raw)));
  const doc = DOMParser.fromSchema(selection.surface.editor.schema).parse(container);
  const anchors = documentBlocks(doc).map((block) => block.anchor);
  const saved = readSelectionTags(raw);
  const byIndex = new Map<number, TaggedBlock>();
  const unresolved: TaggedBlock[] = [];
  for (const entry of saved) {
    const index = resolveBlockAnchor(entry, anchors);
    if (index === null) { unresolved.push(entry); continue; }
    let tags = byIndex.get(index)?.tags ?? [];
    for (const existing of entry.tags) tags = mergeTag(tags, existing);
    byIndex.set(index, { ...anchors[index], tags });
  }
  for (const selected of selection.blocks) {
    const index = resolveBlockAnchor(selected, anchors);
    if (index === null) throw new Error("The selected text changed. Select it again before assigning a tag.");
    byIndex.set(index, { ...anchors[index], tags: mergeTag(byIndex.get(index)?.tags ?? [], tag) });
  }
  const next = writeSelectionTags(raw, [...byIndex.values(), ...unresolved]);
  await writeNote(selection.surface.path, next);
  return next;
}
