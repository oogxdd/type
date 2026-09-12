import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { readTagRegistry, writeTagRegistry } from "../api/tags-api";
import { validTagDefinition, tagKey, type TagDefinition } from "@typenotes/shared/tags";

type TagsContextValue = { tags: TagDefinition[]; loading: boolean; error: string | null; save: (tags: TagDefinition[]) => Promise<void> };
const Context = createContext<TagsContextValue | null>(null);
export function TagsProvider({ children }: { children: ReactNode }) {
  const { activeProfileNotesRoot: root } = useProfiles();
  const [snapshot, setSnapshot] = useState<{ root: string | null; tags: TagDefinition[] }>({ root: null, tags: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentRoot = useRef(root); currentRoot.current = root;
  const generation = useRef(0);
  const writing = useRef<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(null);
    const refresh = async () => {
      if (!root || writing.current === root) { if (!root) setLoading(false); return; }
      const request = ++generation.current;
      try {
        const registry = await readTagRegistry(root);
        if (!disposed && request === generation.current) { setSnapshot({ root, tags: registry.tags.filter(validTagDefinition) }); setError(null); }
      } catch (cause) { if (!disposed && request === generation.current) setError(String(cause)); }
      finally { if (!disposed && request === generation.current) setLoading(false); }
    };
    void refresh();
    window.addEventListener("tag-registry-invalidated", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("note-previews-invalidated", refresh);
    return () => { disposed = true; window.removeEventListener("tag-registry-invalidated", refresh); window.removeEventListener("focus", refresh); window.removeEventListener("note-previews-invalidated", refresh); };
  }, [root]);
  const save = async (tags: TagDefinition[]) => {
    if (!root || currentRoot.current !== root || loading || error || writing.current) throw new Error("Tag registry is not ready. Try again.");
    if (!tags.every(validTagDefinition) || new Set(tags.map(tag => tagKey(tag.name))).size !== tags.length) throw new Error("Use valid, unique tag names and colors.");
    writing.current = root; ++generation.current;
    try {
      await writeTagRegistry(root, { version: 1, tags });
      if (currentRoot.current === root) setSnapshot({ root, tags });
    } finally { writing.current = null; }
  };
  return <Context.Provider value={{ tags: snapshot.root === root ? snapshot.tags : [], loading, error, save }}>{children}</Context.Provider>;
}
export function useTags() {
  const context = useContext(Context);
  if (!context) throw new Error("TagsProvider is missing.");
  return context;
}
