import { useState } from "react";
import { useTags } from "@/features/tags/hooks/tags-context";
import { DEFAULT_TAG_COLOR, tagKey, validTagDefinition, type TagDefinition } from "@typenotes/shared/tags";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { SettingsSection, SettingsCard, SettingsField } from "../settings-ui";
export function SettingsTagsSection() {
  const { tags, save, loading, error } = useTags();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<TagDefinition>({ name: "", color: DEFAULT_TAG_COLOR, description: "" });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const persist = async (next: TagDefinition[]) => {
    setBusy(true); setFailure(null);
    try { await save(next); setEditing(null); setDraft({ name: "", color: DEFAULT_TAG_COLOR, description: "" }); }
    catch (cause) { setFailure(String(cause)); }
    finally { setBusy(false); }
  };
  return <SettingsSection title="Tags" description="Colors apply throughout this working folder. Renaming or deleting a registry entry leaves tags in notes unchanged.">
    {tags.map(tag => <SettingsCard key={tagKey(tag.name)} title={<span style={{ color: tag.color }}>#{tag.name}</span>} description={tag.description}>
      <Button variant="outline" disabled={busy} onClick={() => { setEditing(tagKey(tag.name)); setDraft({ ...tag }); }}>Edit</Button>{" "}
      <Button variant="outline" disabled={busy} onClick={() => void persist(tags.filter(entry => tagKey(entry.name) !== tagKey(tag.name)))}>Delete</Button>
    </SettingsCard>)}
    <SettingsCard title={editing ? "Edit tag" : "Add tag"}>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void persist([...tags.filter(tag => tagKey(tag.name) !== editing), draft]); }}>
        <SettingsField label="Name"><Input aria-label="Tag name" value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.target.value })} /></SettingsField>
        <SettingsField label="Color"><input aria-label="Tag color" type="color" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value })} /></SettingsField>
        <SettingsField label="Description"><Input aria-label="Tag description" value={draft.description ?? ""} onChange={event => setDraft({ ...draft, description: event.target.value })} /></SettingsField>
        <Button type="submit" disabled={busy || loading || Boolean(error) || !validTagDefinition(draft)}>{busy ? "Saving…" : "Save tag"}</Button>
        {editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); setDraft({ name: "", color: DEFAULT_TAG_COLOR, description: "" }); }}>Cancel</Button>}
      </form>
    </SettingsCard>
    {loading && <p role="status">Loading tags…</p>}{(failure || error) && <p role="alert">{failure || error}</p>}
  </SettingsSection>;
}
