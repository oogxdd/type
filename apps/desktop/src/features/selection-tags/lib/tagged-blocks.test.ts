import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { TaggedBlocks, assignEditorTag, documentBlocks, restoreTaggedBlocks, snapshotTaggedBlocks } from "./tagged-blocks";

const schema = getSchema([StarterKit, TaggedBlocks]);
const tag = {name:"Private",color:"#8b5cf6"};
function fixture(texts: string[]) {
  let state = EditorState.create({schema, plugins:[history()], doc:schema.node("doc",null,texts.map(text=>schema.node("paragraph",null,text ? schema.text(text) : undefined)))});
  const editor = { get state(){return state}, view:{dispatch(tr: Parameters<EditorState["apply"]>[0]){state=state.apply(tr)}} } as unknown as Editor;
  return editor;
}

describe("tags live on editor blocks", () => {
  it("assigns multiple blocks and keeps text untouched", () => {
    const editor=fixture(["one","two","three"]);
    assignEditorTag(editor, documentBlocks(editor.state.doc).slice(0,2).map(b=>b.anchor),tag);
    expect(editor.state.doc.textContent).toBe("onetwothree");
    expect(snapshotTaggedBlocks(editor.state.doc).map(b=>b.index)).toEqual([0,1]);
  });
  it("follows insertions above and edits inside the tagged paragraph", () => {
    const editor=fixture(["before","selected","after"]);
    assignEditorTag(editor,[documentBlocks(editor.state.doc)[1].anchor],tag);
    editor.view.dispatch(editor.state.tr.insert(0,schema.node("paragraph",null,schema.text("new"))));
    const selected=documentBlocks(editor.state.doc)[2];
    editor.view.dispatch(editor.state.tr.insertText(" updated",selected.pos+selected.node.nodeSize-1));
    const saved=snapshotTaggedBlocks(editor.state.doc);
    expect(saved[0].index).toBe(2);
    const reopened=fixture(["new","before","selected updated","after"]);
    expect(restoreTaggedBlocks(reopened,saved)).toEqual([]);
    expect(snapshotTaggedBlocks(reopened.state.doc)[0].tags).toEqual([tag]);
  });
  it("supports undo and redo of tag assignment independently of typing", () => {
    const editor=fixture(["one"]);
    assignEditorTag(editor,[documentBlocks(editor.state.doc)[0].anchor],tag);
    expect(undo(editor.state,editor.view.dispatch)).toBe(true);
    expect(snapshotTaggedBlocks(editor.state.doc)).toEqual([]);
    expect(redo(editor.state,editor.view.dispatch)).toBe(true);
    expect(snapshotTaggedBlocks(editor.state.doc)[0].tags).toEqual([tag]);
  });
  it("removes tags when deleting their paragraph and restores them on undo", () => {
    const editor=fixture(["one","two"]);
    assignEditorTag(editor,[documentBlocks(editor.state.doc)[0].anchor],tag);
    const first=editor.state.doc.firstChild!;
    editor.view.dispatch(editor.state.tr.delete(0,first.nodeSize));
    expect(snapshotTaggedBlocks(editor.state.doc)).toEqual([]);
    undo(editor.state,editor.view.dispatch);
    expect(snapshotTaggedBlocks(editor.state.doc)[0].tags).toEqual([tag]);
  });
  it("splitting a tagged paragraph keeps its tag on both pieces", () => {
    const editor=fixture(["one two"]);
    assignEditorTag(editor,[documentBlocks(editor.state.doc)[0].anchor],tag);
    editor.view.dispatch(editor.state.tr.split(4));
    expect(snapshotTaggedBlocks(editor.state.doc)).toHaveLength(2);
  });
  it("retains unresolved metadata when external edits prevent a safe match", () => {
    const source=fixture(["one"]);
    assignEditorTag(source,[documentBlocks(source.state.doc)[0].anchor],tag);
    const saved=snapshotTaggedBlocks(source.state.doc);
    const edited=fixture(["different"]);
    expect(restoreTaggedBlocks(edited,saved)).toEqual(saved);
    expect(snapshotTaggedBlocks(edited.state.doc)).toEqual([]);
  });
  it("restores tags after an external insertion without adding an undo step", () => {
    const source=fixture(["before","selected"]);
    assignEditorTag(source,[documentBlocks(source.state.doc)[1].anchor],tag);
    const reopened=fixture(["new","before","selected"]);
    restoreTaggedBlocks(reopened,snapshotTaggedBlocks(source.state.doc));
    expect(snapshotTaggedBlocks(reopened.state.doc)[0].index).toBe(2);
    expect(undo(reopened.state,reopened.view.dispatch)).toBe(false);
  });
});
