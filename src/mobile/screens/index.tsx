import type { MutableRefObject, MouseEvent as ReactMouseEvent } from "react";
import type { MobileAction, MobileRoute } from "../navigation";
import type { NoteEntry } from "../../types";
import type { NotePreview } from "../../utils/format";
import type { FlattenedItem } from "@/features/tree/types";
import type { SettingsSectionId } from "@/features/settings/sections";
import type { RecentBucket } from "../hooks/useRecentBuckets";

import { PhoneHomeScreen } from "./PhoneHomeScreen";
import { PhoneFoldersScreen } from "./PhoneFoldersScreen";
import { PhoneNotesScreen } from "./PhoneNotesScreen";
import { PhoneRecentDateScreen } from "./PhoneRecentDateScreen";
import { PhoneRecordingScreen } from "./PhoneRecordingScreen";
import { PhoneEditorScreen } from "./PhoneEditorScreen";
import { PhoneSettingsScreen } from "./PhoneSettingsScreen";

type PhoneRouteRendererProps = {
  currentRoute: MobileRoute;
  // Home screen
  keyboardInset: number;
  createNewNote: (
    preferredFolderPath?: string,
    initialContent?: string,
    targetTimestampMs?: number
  ) => Promise<string | null>;
  openEditorRoute: (notePath: string, folderPath?: string) => void;
  nextTransitionRef: MutableRefObject<"forward" | "backward" | "up" | null>;
  dispatch: React.Dispatch<MobileAction>;
  // Folders screen
  navigationTab: "folders" | "recent";
  navigationFolders: FlattenedItem[];
  activeFolder: string;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  openNotesRoute: (folderPath: string) => void;
  openFolderActionSheet: (path: string) => void;
  recentBuckets: RecentBucket[];
  openRecentBucketRoute: (bucketId: string) => void;
  // Notes screen
  activeFolderTitle: string;
  notes: NoteEntry[];
  notePreviews: Record<string, NotePreview>;
  activeNote: string | null;
  showToast: (message: string, tone?: "info" | "success" | "error") => void;
  onDeleteNote: (path: string) => Promise<boolean>;
  onArchiveNote: (path: string) => Promise<void>;
  openNoteActionSheet: (path: string) => void;
  onNoteContextMenu: (
    event: ReactMouseEvent,
    notePath: string,
    parentPath?: string
  ) => Promise<void>;
  refreshNotesFeed: (folderPath: string) => Promise<void>;
  // Recent date screen
  allNotePreviews: Record<string, NotePreview>;
  recentBucketById: Map<string, RecentBucket>;
  refreshTree: () => Promise<void>;
  // Settings screen
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
};

export function PhoneRouteRenderer(props: PhoneRouteRendererProps) {
  const { currentRoute } = props;

  if (currentRoute.kind === "home") {
    return <PhoneHomeScreen keyboardInset={props.keyboardInset} />;
  }

  if (currentRoute.kind === "folders") {
    return (
      <PhoneFoldersScreen
        navigationTab={props.navigationTab}
        navigationFolders={props.navigationFolders}
        activeFolder={props.activeFolder}
        expanded={props.expanded}
        onToggleFolder={props.onToggleFolder}
        openNotesRoute={props.openNotesRoute}
        openFolderActionSheet={props.openFolderActionSheet}
        recentBuckets={props.recentBuckets}
        openRecentBucketRoute={props.openRecentBucketRoute}
      />
    );
  }

  if (currentRoute.kind === "notes") {
    return (
      <PhoneNotesScreen
        folderPath={currentRoute.folderPath}
        activeFolderTitle={props.activeFolderTitle}
        notes={props.notes}
        notePreviews={props.notePreviews}
        activeNote={props.activeNote}
        openEditorRoute={props.openEditorRoute}
        createNewNote={props.createNewNote}
        showToast={props.showToast}
        onDeleteNote={props.onDeleteNote}
        onArchiveNote={props.onArchiveNote}
        openNoteActionSheet={props.openNoteActionSheet}
        onNoteContextMenu={props.onNoteContextMenu}
        refreshNotesFeed={props.refreshNotesFeed}
      />
    );
  }

  if (currentRoute.kind === "recent-date") {
    return (
      <PhoneRecentDateScreen
        bucketId={currentRoute.bucketId}
        recentBucketById={props.recentBucketById}
        allNotePreviews={props.allNotePreviews}
        activeNote={props.activeNote}
        openEditorRoute={props.openEditorRoute}
        createNewNote={props.createNewNote}
        showToast={props.showToast}
        onDeleteNote={props.onDeleteNote}
        onArchiveNote={props.onArchiveNote}
        openNoteActionSheet={props.openNoteActionSheet}
        onNoteContextMenu={props.onNoteContextMenu}
        refreshTree={props.refreshTree}
      />
    );
  }

  if (currentRoute.kind === "recording") {
    return (
      <PhoneRecordingScreen
        folderPath={currentRoute.folderPath}
        autoStart={currentRoute.autoStart}
      />
    );
  }

  if (currentRoute.kind === "editor") {
    return (
      <PhoneEditorScreen
        folderPath={currentRoute.folderPath}
        keyboardInset={props.keyboardInset}
        createNewNote={props.createNewNote}
        nextTransitionRef={props.nextTransitionRef}
        dispatch={props.dispatch}
      />
    );
  }

  // settings
  return (
    <PhoneSettingsScreen
      activeSettingsSection={props.activeSettingsSection}
      onSettingsSectionChange={props.onSettingsSectionChange}
    />
  );
}
