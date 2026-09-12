import { DOMParser } from "@tiptap/pm/model";
import { readNote, writeNote } from "@/features/notes/api/notes-api";
import { markdownToHtml, htmlToMarkdown } from "@/features/notes/editor/lib/markdown-editor";
import { stripInlineAnnotationMetadata } from "@typenotes/shared/annotation-metadata";
import { stripFrontmatter } from "@typenotes/shared/frontmatter";
import type { SelectionTag } from "@typenotes/shared/selection-tags";
import { assignEditorTag } from "./tagged-blocks";
import { isTagSurfaceCurrent, type CapturedTagSelection } from "./selection-surfaces";

/** Review tags reserialize Markdown, including the editor's normal canonicalization. */
export async function persistReviewTag(selection: CapturedTagSelection, tag: SelectionTag): Promise<string> {
  if (!isTagSurfaceCurrent(selection.surface)) throw new Error("The note changed. Select the text again.");
  const raw = await readNote(selection.surface.path);
  const container = document.createElement("div");
  container.innerHTML = markdownToHtml(stripInlineAnnotationMetadata(stripFrontmatter(raw)));
  const editor = selection.surface.editor;
  const doc = DOMParser.fromSchema(editor.schema).parse(container);
  if (!isTagSurfaceCurrent(selection.surface) || !doc.eq(selection.doc) || !editor.state.doc.eq(selection.doc)) throw new Error("The selected text changed. Select it again.");
  assignEditorTag(editor, selection.blocks, tag);
  const next = htmlToMarkdown(editor.getHTML());
  try { await writeNote(selection.surface.path, next); }
  catch (error) { editor.commands.undo(); throw error; }
  return next;
}
