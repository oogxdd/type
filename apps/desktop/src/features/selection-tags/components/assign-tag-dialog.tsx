import { useTags } from "@/features/tags/hooks/tags-context";
import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useSelection } from "@/app/state/selection-store";
import { getErrorMessage } from "@typenotes/shared/errors";
import { DEFAULT_TAG_COLOR, tagKey, validTag, type SelectionTag } from "@typenotes/shared/selection-tags";
import { assignEditorTag } from "../lib/tagged-blocks";
import { isTagSurfaceCurrent, openDocumentTags, type CapturedTagSelection } from "../lib/selection-surfaces";
import { persistReviewTag } from "../lib/persist-selection-tag";

const COLORS = ["#8b5cf6", "#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#ea580c", "#e11d48", "#64748b"];

export function AssignTagDialog({ selection, onClose }: {
  selection: CapturedTagSelection[];
  onClose: () => void;
}) {
  const { tags: registry, save: saveRegistry, loading, error: registryError } = useTags();
  const { flushSave, loadedNotePath, primeNoteContent } = useEditor();
  const activeNote = useSelection((state) => state.activeNote);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_TAG_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const completedRef = useRef(new Set<string>());
  const catalog = useMemo(() => {
    const found = new Map<string, SelectionTag>(registry.map(tag => [tagKey(tag.name), tag]));
    for (const tag of openDocumentTags()) {
      if (!found.has(tagKey(tag.name))) found.set(tagKey(tag.name), tag);
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [registry, selection]);

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
      if (!registry.some(entry => tagKey(entry.name) === tagKey(tag.name) && entry.color === color)) {
        await saveRegistry([...registry.filter(entry => tagKey(entry.name) !== tagKey(tag.name)), { ...tag, description: registry.find(entry => tagKey(entry.name) === tagKey(tag.name))?.description ?? "" }]);
      }
      // The editor's navigation effect owns a pending old-note flush.
      if (loadedNotePath === activeNote) await flushSave();
      for (const target of selection) {
        if (completedRef.current.has(target.surface.path)) continue;
        if (!isTagSurfaceCurrent(target.surface)) throw new Error("The selection changed. Select the text again.");
        if (target.surface.editable) {
          if (!target.surface.editor.state.doc.eq(target.doc)) throw new Error("The selected text changed. Select it again.");
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
          <DialogDescription>{blockCount} text block{blockCount === 1 ? "" : "s"} in {selection.length} note{selection.length === 1 ? "" : "s"}. Tags cover the selected phrase or blocks.</DialogDescription>
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
            {loading ? <p role="status">Loading tag registry…</p> : !matching.length ? <p>{name.trim() ? `Create “${name.trim()}”` : "No tags yet. Give your first tag a name."}</p> : null}
            {registryError ? <p role="status">The tag registry could not be read.</p> : null}
          </div>
          <fieldset disabled={fieldsDisabled}>
            <legend>Color</legend>
            <div className="selection-tag-colors">
              {COLORS.map((value) => <button key={value} type="button" style={{ background: value }} aria-label={`Use color ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} />)}
              <input type="color" aria-label="Custom tag color" value={color} onChange={(event) => setColor(event.target.value)} />
            </div>
          </fieldset>
          <div className="selection-tag-preview" style={{ background: `${color}1a`, borderColor: color }}>{name.trim() || "Your tagged text"}</div>
          {existing ? <p className="selection-tag-hint">Color applies to every occurrence of this tag.</p> : null}
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
