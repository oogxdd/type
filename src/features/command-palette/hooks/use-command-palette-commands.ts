import { useEffect, useState, type ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArchiveIcon,
  DownloadIcon,
  FilePlusIcon,
  FolderInputIcon,
  ImageIcon,
  InboxIcon,
  MicIcon,
  MoonIcon,
  PencilIcon,
  SettingsIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";

import { useSelection } from "@/app/state/selection-store";
import { useNotesTree } from "@/features/notes/hooks/notes-tree-context";
import { useAppearance } from "@/app/state/appearance-store";
import { FEED_FOLDER_PATH, isSystemFolder } from "@/shared/constants";
import { getNoteParentPath } from "@/shared/lib/notes";
import type { SettingsSectionId } from "@/features/settings/lib/sections";

type CommandPaletteProps = {
  onOpenSettings: (section: SettingsSectionId) => void;
  onOpenFeed: () => void;
  onOpenArchive: () => void;
  onNewRecording: () => void;
  onImportHandwriting: () => void;
};

type PaletteCommand = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string[];
  run: () => void;
};

type PaletteGroup = {
  heading: string;
  items: PaletteCommand[];
};

type UseCommandPaletteCommandsArgs = CommandPaletteProps;

const folderName = (path: string) => path.split("/").pop() || path;

export function useCommandPaletteCommands({
  onOpenSettings,
  onOpenFeed,
  onOpenArchive,
  onNewRecording,
  onImportHandwriting,
}: UseCommandPaletteCommandsArgs) {
  const [open, setOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [destinationPath, setDestinationPath] = useState("");
  const [moveTargets, setMoveTargets] = useState<string[]>([]);

  const { selectedNotes, selectedFolders, activeNote, activeFolder } = useSelection(
    useShallow((state) => ({
      selectedNotes: state.selectedNotes,
      selectedFolders: state.selectedFolders,
      activeNote: state.activeNote,
      activeFolder: state.activeFolder,
    }))
  );
  const {
    createNewNote,
    deleteNotes,
    deleteFolders,
    moveNotesToArchive,
    moveNotesToFolder,
    flattenIntoFeed,
    updateNoteMarkers,
    startRenameFolder,
    allNotePreviews,
  } = useNotesTree();
  const { theme, setTheme } = useAppearance(
    useShallow((state) => ({
      theme: state.theme,
      setTheme: state.setTheme,
    }))
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const noteTargets =
    selectedNotes.size > 0
      ? Array.from(selectedNotes)
      : activeNote
        ? [activeNote]
        : [];
  const folderTargets = Array.from(selectedFolders);
  const removableFolders = folderTargets.filter((path) => !isSystemFolder(path));
  const notesOutsideFeed = noteTargets.filter(
    (path) => getNoteParentPath(path) !== FEED_FOLDER_PATH
  );
  const canFlatten = removableFolders.length > 0 || notesOutsideFeed.length > 0;
  const allArchived =
    noteTargets.length > 0 && noteTargets.every((path) => allNotePreviews[path]?.isArchived);
  const allReviewed =
    noteTargets.length > 0 && noteTargets.every((path) => allNotePreviews[path]?.isReviewed);

  const selectionCommands: PaletteCommand[] = [];
  if (noteTargets.length > 0) {
    selectionCommands.push({
      id: "move-notes-folder",
      label:
        noteTargets.length > 1
          ? `Move ${noteTargets.length} notes to folder...`
          : "Move note to folder...",
      icon: FolderInputIcon,
      keywords: ["move", "folder", "destination"],
      run: () => {
        setMoveTargets(noteTargets);
        setDestinationPath("");
        setMoveDialogOpen(true);
      },
    });
    selectionCommands.push({
      id: "toggle-archive",
      label: allArchived ? "Unarchive notes" : "Archive notes",
      icon: ArchiveIcon,
      keywords: ["archive", "hide", "review"],
      run: () =>
        void updateNoteMarkers(noteTargets, {
          archived: allArchived ? null : true,
        }),
    });
    selectionCommands.push({
      id: "toggle-reviewed",
      label: allReviewed ? "Mark notes unreviewed" : "Mark notes reviewed",
      icon: PencilIcon,
      keywords: ["reviewed", "done", "checked"],
      run: () =>
        void updateNoteMarkers(noteTargets, {
          reviewed: allReviewed ? null : true,
        }),
    });
    selectionCommands.push({
      id: "archive-notes",
      label: `Archive ${noteTargets.length} note${noteTargets.length > 1 ? "s" : ""}`,
      icon: ArchiveIcon,
      keywords: ["move", "archive", "trash"],
      run: () => void moveNotesToArchive(noteTargets),
    });
    selectionCommands.push({
      id: "delete-notes",
      label: `Delete ${noteTargets.length} note${noteTargets.length > 1 ? "s" : ""}`,
      icon: Trash2Icon,
      keywords: ["remove"],
      run: () => void deleteNotes(noteTargets),
    });
  }
  if (canFlatten) {
    selectionCommands.push({
      id: "flatten-into-feed",
      label:
        removableFolders.length > 0
          ? `Flatten ${removableFolders.length} folder${removableFolders.length > 1 ? "s" : ""} into Feed`
          : `Move ${notesOutsideFeed.length} note${notesOutsideFeed.length > 1 ? "s" : ""} into Feed`,
      icon: FolderInputIcon,
      keywords: ["flatten", "move", "feed", "collapse"],
      run: () => void flattenIntoFeed(folderTargets, noteTargets),
    });
  }
  if (folderTargets.length === 1 && !isSystemFolder(folderTargets[0])) {
    const folder = folderTargets[0];
    selectionCommands.push({
      id: "new-note-in-folder",
      label: `New note in "${folderName(folder)}"`,
      icon: FilePlusIcon,
      keywords: ["create", "add"],
      run: () => void createNewNote(folder),
    });
    selectionCommands.push({
      id: "rename-folder",
      label: `Rename "${folderName(folder)}"`,
      icon: PencilIcon,
      run: () => startRenameFolder(folder),
    });
  }
  if (removableFolders.length > 0) {
    selectionCommands.push({
      id: "delete-folders",
      label: `Delete ${removableFolders.length} folder${removableFolders.length > 1 ? "s" : ""}`,
      icon: Trash2Icon,
      keywords: ["remove"],
      run: () => void deleteFolders(removableFolders),
    });
  }

  const createCommands: PaletteCommand[] = [
    {
      id: "new-note",
      label: "New note",
      icon: FilePlusIcon,
      keywords: ["create", "add"],
      run: () => void createNewNote(activeFolder || undefined),
    },
    {
      id: "new-recording",
      label: "New recording",
      icon: MicIcon,
      keywords: ["audio", "record", "voice"],
      run: onNewRecording,
    },
    {
      id: "import-image",
      label: "Import image (handwriting)",
      icon: ImageIcon,
      keywords: ["ocr", "handwriting", "photo", "attachment"],
      run: onImportHandwriting,
    },
  ];

  const navigateCommands: PaletteCommand[] = [
    {
      id: "go-feed",
      label: "Go to Feed",
      icon: InboxIcon,
      keywords: ["home", "notes"],
      run: onOpenFeed,
    },
    {
      id: "go-archive",
      label: "Go to Archive",
      icon: ArchiveIcon,
      keywords: ["trash", "archieve"],
      run: onOpenArchive,
    },
    {
      id: "open-settings",
      label: "Open Settings",
      icon: SettingsIcon,
      keywords: ["preferences", "config"],
      run: () => onOpenSettings("general"),
    },
    {
      id: "import-apple-notes",
      label: "Import Apple Notes…",
      icon: DownloadIcon,
      keywords: ["import", "apple", "migrate"],
      run: () => onOpenSettings("import"),
    },
  ];

  const viewCommands: PaletteCommand[] = [
    {
      id: "toggle-theme",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: theme === "dark" ? SunIcon : MoonIcon,
      keywords: ["dark", "light", "appearance"],
      run: () => setTheme(theme === "dark" ? "light" : "dark"),
    },
  ];

  const groups: PaletteGroup[] = [
    { heading: "Selection", items: selectionCommands },
    { heading: "Create", items: createCommands },
    { heading: "Navigate", items: navigateCommands },
    { heading: "View", items: viewCommands },
  ].filter((group) => group.items.length > 0);

  const runCommand = (command: PaletteCommand) => {
    setOpen(false);
    command.run();
  };

  const submitMoveToFolder = async () => {
    const nextDestination = destinationPath.trim();
    if (!nextDestination) {
      return;
    }
    await moveNotesToFolder(moveTargets, nextDestination);
    setMoveDialogOpen(false);
    setDestinationPath("");
    setMoveTargets([]);
  };

  return {
    open,
    setOpen,
    groups,
    runCommand,
    moveDialogOpen,
    setMoveDialogOpen,
    destinationPath,
    setDestinationPath,
    submitMoveToFolder,
    moveTargets,
    setMoveTargets,
  };
}
