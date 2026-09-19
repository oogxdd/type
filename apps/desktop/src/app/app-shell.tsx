import { useCallback, useRef, useState, type ChangeEvent } from "react";

import { useNoteOpener } from "@/app/hooks/use-note-opener";
import { useSelection } from "@/app/state/selection-store";
import { DesktopAppShell } from "@/desktop/desktop-app-shell";
import { CommandPalette } from "@/features/command-palette/components/command-palette";
import { useHandwriting } from "@/features/handwriting/hooks/handwriting-context";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import { useGlobalShortcutDispatcher } from "@/shared/keyboard/use-global-shortcuts";
import { focusNoScroll } from "@/shared/lib/dom";
import type { SettingsSectionId } from "@/features/settings/lib/sections";
import { ARCHIVE_FOLDER_PATH, STREAM_FOLDER_PATH } from "@typenotes/shared/constants";
import type { AppMode } from "@typenotes/shared/types";

export function AppShell() {
  // The one listener for every modified keystroke; see shared/keyboard/keymap.
  useGlobalShortcutDispatcher();

  const [desktopAppMode, setDesktopAppMode] = useState<AppMode>("notes");
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>("general");
  const handwritingInputRef = useRef<HTMLInputElement | null>(null);
  const foldersPanelRef = useRef<HTMLDivElement | null>(null);

  const activeFolder = useSelection((state) => state.activeFolder);
  const { isRecordingAudio, startRecording } = useRecordings();
  const { importHandwritingFile } = useHandwriting();
  const { openPinnedFolder } = useNoteOpener({ setAppMode: setDesktopAppMode });
  const restoreNavigationFocus = useCallback(() => {
    focusNoScroll(foldersPanelRef.current);
  }, []);

  const onHandwritingImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    void importHandwritingFile(file, activeFolder || undefined).catch((error) => {
      console.error("[handwriting] import failed", error);
    });
  };

  return (
    <>
      <input
        ref={handwritingInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={onHandwritingImportChange}
      />
      <CommandPalette
        onOpenSettings={(section) => {
          setActiveSettingsSection(section);
          setDesktopAppMode("settings");
        }}
        onOpenFeed={() => openPinnedFolder(STREAM_FOLDER_PATH)}
        onOpenArchive={() => openPinnedFolder(ARCHIVE_FOLDER_PATH)}
        onMoveFocusRestore={restoreNavigationFocus}
        onNewRecording={() => {
          if (!isRecordingAudio) {
            void startRecording(activeFolder || undefined);
          }
        }}
        onImportHandwriting={() => handwritingInputRef.current?.click()}
      />
      <DesktopAppShell
        appMode={desktopAppMode}
        onAppModeChange={setDesktopAppMode}
        activeSettingsSection={activeSettingsSection}
        onSettingsSectionChange={setActiveSettingsSection}
        onImportHandwriting={() => handwritingInputRef.current?.click()}
        onOpenPinnedFolder={openPinnedFolder}
        foldersPanelRef={foldersPanelRef}
      />
    </>
  );
}
