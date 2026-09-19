import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { MailboxAction, MailboxStatus } from "@typenotes/shared/types";
import { getErrorMessage } from "@typenotes/shared/errors";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { useEditor } from "@/features/notes/editor/hooks/editor-context";
import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { useGitSync } from "./git-sync-context";
import { mailboxSync } from "../api/mailbox-api";

type Value = {
  status: MailboxStatus | null;
  busy: boolean;
  error: string | null;
  execute: (args: MailboxAction) => Promise<MailboxStatus | null>;
};
const Context = createContext<Value | null>(null);

export function MailboxProvider({ children }: { children: ReactNode }) {
  const { activeProfileId, activeProfileNotesRoot } = useProfiles();
  const editor = useEditor();
  const tree = useNotesTree();
  const git = useGitSync();
  const [status, setStatus] = useState<MailboxStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profileKey = JSON.stringify([activeProfileId, activeProfileNotesRoot]);
  const current = useRef({ editor, tree, git, profileKey });
  current.current = { editor, tree, git, profileKey };
  const running = useRef(false);

  const execute = useCallback(async (args: MailboxAction) => {
    if (running.current || current.current.git.gitSyncBusy) return null;
    running.current = true;
    const profile = current.current.profileKey;
    setBusy(true);
    try {
      if (args.action === "sync") await current.current.editor.flushSave();
      if (current.current.profileKey !== profile) return null;
      const result = await mailboxSync(args);
      if (current.current.profileKey !== profile) return null;
      // Pairing material is displayed only by the component that requested it.
      const { pairing_secret: _secret, ...publicStatus } = result;
      setStatus(publicStatus);
      setError(null);
      if (args.action === "sync") {
        await current.current.tree.refreshTree();
        window.dispatchEvent(new CustomEvent("note-previews-invalidated"));
        window.dispatchEvent(new CustomEvent("tag-registry-invalidated"));
      }
      return result;
    } catch (cause) {
      if (current.current.profileKey === profile) setError(getErrorMessage(cause));
      return null;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setStatus(null); setError(null);
    let cancelled = false;
    // Read directly so a previous profile's in-flight exchange cannot suppress
    // loading the newly selected folder's configuration.
    void mailboxSync({ action: "status" }).then(value => {
      if (!cancelled) setStatus(value);
    }).catch(cause => { if (!cancelled) setError(getErrorMessage(cause)); });
    return () => { cancelled = true; };
  }, [profileKey]);

  useEffect(() => {
    if (!status?.enabled) return;
    const sync = () => { void execute({ action: "sync" }); };
    sync();
    const timer = window.setInterval(sync, 30_000);
    window.addEventListener("online", sync);
    return () => { window.clearInterval(timer); window.removeEventListener("online", sync); };
  }, [status?.enabled, profileKey, execute]);

  return <Context.Provider value={{ status, busy, error, execute }}>{children}</Context.Provider>;
}
export function useMailbox() {
  const value = useContext(Context);
  if (!value) throw new Error("MailboxProvider is missing");
  return value;
}
