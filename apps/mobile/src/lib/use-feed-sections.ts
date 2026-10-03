import { useEffect, useId, useRef, useState } from "react";
import { AppState } from "react-native";
import { STREAM_FOLDER_PATH } from "@typenotes/shared/constants";
import type { NoteEntry } from "@typenotes/shared/types";
import { useNotesStore } from "../state/notes-store";
import { findFolder, type NoteRowSection } from "./feed";
import { runNoteJob } from "./note-worker";

const calendarKey = () => {
  const now = new Date();
  return `${now.toDateString()}:${now.getTimezoneOffset()}`;
};

/** Sorting/grouping stays in the worker; unchanged sections retain identity. */
export const useFeedSections = (filter: "all" | "active" | "archived", ready = true) => {
  const key = useId();
  const notes = useNotesStore((state) => findFolder(state.tree, STREAM_FOLDER_PATH)?.notes);
  const previews = useNotesStore((state) => state.folderPreviews.get(STREAM_FOLDER_PATH));
  const scope = useNotesStore((state) => state.processingScope);
  const [shown, setShown] = useState<{ scope: string; sections: NoteRowSection[] }>({ scope, sections: [] });
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const sent = useRef<{ scope: string; notes: NoteEntry[] | undefined } | null>(null);
  const request = useRef(0);
  const heldSections = useRef<{ scope: string; sections: Map<string, NoteRowSection> }>({ scope, sections: new Map() });
  const [day, setDay] = useState(calendarKey);
  useEffect(() => () => { void runNoteJob({ kind: "releaseFeed", scope, key }).catch(() => {}); }, [scope, key]);
  useEffect(() => {
    const update = () => setDay(calendarKey());
    const timer = setInterval(update, 60_000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const revision = ++request.current;
    const replaceNotes = sent.current?.scope !== scope || sent.current.notes !== notes;
    sent.current = { scope, notes };
    void runNoteJob({ kind: "feed", scope, key, notes: replaceNotes ? notes ?? [] : undefined, filter, now: Date.now() }).then((result) => {
      if (!result.sectionTitles || latestScope.current !== scope) return;
      if (heldSections.current.scope !== scope) heldSections.current = { scope, sections: new Map() };
      const held = heldSections.current.sections;
      for (const section of result.sections ?? []) held.set(section.title, section);
      if (revision !== request.current) return;
      setShown((previous) => {
        const next = result.sectionTitles!.map((title) => held.get(title)!);
        return previous.scope === scope && next.length === previous.sections.length && next.every((section, index) => section === previous.sections[index]) ? previous : { scope, sections: next };
      });
    }).catch(() => { sent.current = null; });
    return () => { request.current += 1; };
  }, [notes, previews, filter, ready, scope, key, day]);
  return shown.scope === scope ? shown.sections : [];
};
