import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { readNote } from "@/features/notes/api/notes-api";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useSelection } from "@/app/state/selection-store";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { collectAllNotes } from "@typenotes/shared/notes";
import { getErrorMessage } from "@typenotes/shared/errors";
import { DEFAULT_TAG_COLOR, readSelectionTags, tagKey, validTag, type SelectionTag } from "@typenotes/shared/selection-tags";
import { assignEditorTag, snapshotTaggedBlocks } from "../lib/tagged-blocks";
import { isTagSurfaceCurrent, type CapturedTagSelection } from "../lib/selection-surfaces";
import { persistReviewTag } from "../lib/persist-selection-tag";

const COLORS = ["#8b5cf6", "#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#ea580c", "#e11d48", "#64748b"];

export function AssignTagDialog({ selection, onClose }: {
  selection: CapturedTagSelection[];
  onClose: () => void;
}) {
  const { tree } = useNotesTree();
  const { flushSave, loadedNotePath, primeNoteContent } = useEditor();
  const activeNote = useSelection((state) => state.activeNote);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_TAG_COLOR);
  const [catalog, setCatalog] = useState<SelectionTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const completedRef = useRef(new Set<string>());
  const paths = useMemo(() => collectAllNotes(tree).map((note) => note.path), [tree]);

  useEffect(() => {
    let cancelled = false;
    const found = new Map<string, SelectionTag>();
    const add = (tag: SelectionTag) => { if (!found.has(tagKey(tag.name))) found.set(tagKey(tag.name), tag); };
    // Include unsaved tags from the live editor immediately.
    for (const target of selection) {
      for (const block of snapshotTaggedBlocks(target.surface.editor.state.doc)) block.tags.forEach(add);
    }
    setCatalog([...found.values()]);
    setLoading(true);
    setCatalogError(false);
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < paths.length) {
        const path = paths[cursor++];
        try { readSelectionTags(await readNote(path)).forEach((block) => block.tags.forEach(add)); }
        catch { if (!cancelled) setCatalogError(true); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(6, paths.length) }, worker)).then(() => {
      if (cancelled) return;
      setCatalog([...found.values()].sort((a, b) => a.name.localeCompare(b.name)));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [paths, selection]);

  const matching = catalog.filter((tag) => tagKey(tag.name).includes(tagKey(name)));
  const existing = catalog.find((tag) => tagKey(tag.name) === tagKey(name));
  const tag = { name: existing?.name ?? name.trim(), color };
  const fieldsDisabled = saving || completedRef.current.size > 0;
  const blockCount = selection.reduce((sum, target) => sum + target.blocks.length, 0);

  const assign = async () => {
    if (busyRef.current || !validTag(tag)) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (selection.some((target) => !isTagSurfaceCurrent(target.surface))) throw new Error("The selection changed. Close this window and select the text again.");
      // The editor's navigation effect owns a pending old-note flush.
      if (loadedNotePath === activeNote) await flushSave();
      for (const target of selection) {
        if (completedRef.current.has(target.surface.path)) continue;
        if (!isTagSurfaceCurrent(target.surface)) throw new Error("The selection changed. Select the text again.");
        if (target.surface.editable) {
          assignEditorTag(target.surface.editor, target.blocks, tag);
          await flushSave();
        } else {
          const next = await persistReviewTag(target, tag);
          if (loadedNotePath === target.surface.path) primeNoteContent(next);
        }
        completedRef.current.add(target.surface.path);
      }
      window.dispatchEvent(new CustomEvent("note-previews-invalidated"));
      onClose();
    } catch (cause) {
      const count = completedRef.current.size;
      setError(`${count ? `Saved to ${count} note(s). ` : ""}${getErrorMessage(cause)}`);
      if (count) window.dispatchEvent(new CustomEvent("note-previews-invalidated"));
    } finally { busyRef.current = false; setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busyRef.current) onClose(); }}>
      <DialogContent showCloseButton={!saving} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Assign tag</DialogTitle>
          <DialogDescription>{blockCount} text block{blockCount === 1 ? "" : "s"} in {selection.length} note{selection.length === 1 ? "" : "s"}. Tags cover whole paragraphs and list items.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void assign(); }} className="selection-tag-form">
          <label htmlFor="selection-tag-name">Tag name</label>
          <Input id="selection-tag-name" placeholder="Find or create a tag…" maxLength={80} value={name} disabled={fieldsDisabled} onChange={(event) => {
            const next = event.target.value;
            setName(next);
            const found = catalog.find((entry) => tagKey(entry.name) === tagKey(next));
            if (found) setColor(found.color);
          }} autoFocus />
          <div className="selection-tag-catalog" aria-label="Existing tags">
            {matching.map((entry) => <button type="button" disabled={fieldsDisabled} key={tagKey(entry.name)} onClick={() => { setName(entry.name); setColor(entry.color); }} className="selection-tag-option" aria-pressed={tagKey(entry.name) === tagKey(name)}>
              <span style={{ background: entry.color }} aria-hidden="true" />{entry.name}
            </button>)}
            {loading ? <p role="status">Looking for tags in this working folder…</p> : !matching.length ? <p>{name.trim() ? `Create “${name.trim()}”` : "No tags yet. Give your first tag a name."}</p> : null}
            {catalogError ? <p role="status">Some notes could not be read. The tag list may be incomplete.</p> : null}
          </div>
          <fieldset disabled={fieldsDisabled}>
            <legend>Color</legend>
            <div className="selection-tag-colors">
              {COLORS.map((value) => <button key={value} type="button" style={{ background: value }} aria-label={`Use color ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} />)}
              <input type="color" aria-label="Custom tag color" value={color} onChange={(event) => setColor(event.target.value)} />
            </div>
          </fieldset>
          <div className="selection-tag-preview" style={{ background: `${color}1a`, borderColor: color }}>{name.trim() || "Your tagged text"}</div>
          {existing ? <p className="selection-tag-hint">Color applies to this selection. Other tagged text keeps its color.</p> : null}
          {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !validTag(tag)}>{saving ? "Saving…" : completedRef.current.size ? "Retry remaining notes" : existing ? "Assign tag" : "Create & assign"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
