import { useRef, useState, type ChangeEvent } from "react";

import { useNoteOpener } from "@/hooks/use-note-opener";
import { useSelection } from "@/state/selection-store";
import { WorkspaceShell } from "./workspace-shell";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { useHandwriting } from "@/state/handwriting-context";
import { useRecordings } from "@/state/recordings-context";
import type { SettingsSectionId } from "@/lib/settings-sections";
import { ARCHIEVE_FOLDER_PATH, FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import type { AppMode } from "@typenotes/shared/types";

export function AppShell() {
  const [desktopAppMode, setDesktopAppMode] = useState<AppMode>("notes");
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>("general");
  const handwritingInputRef = useRef<HTMLInputElement | null>(null);

  const activeFolder = useSelection((state) => state.activeFolder);
  const { isRecordingAudio, startRecording } = useRecordings();
  const { importHandwritingFile } = useHandwriting();
  const { openPinnedFolder } = useNoteOpener({ setAppMode: setDesktopAppMode });

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
        onOpenFeed={() => openPinnedFolder(FEED_FOLDER_PATH)}
        onOpenArchive={() => openPinnedFolder(ARCHIEVE_FOLDER_PATH)}
        onNewRecording={() => {
          if (!isRecordingAudio) {
            void startRecording(activeFolder || undefined);
          }
        }}
        onImportHandwriting={() => handwritingInputRef.current?.click()}
      />
      <WorkspaceShell
        appMode={desktopAppMode}
        onAppModeChange={setDesktopAppMode}
        activeSettingsSection={activeSettingsSection}
        onSettingsSectionChange={setActiveSettingsSection}
        onImportHandwriting={() => handwritingInputRef.current?.click()}
        onOpenPinnedFolder={openPinnedFolder}
      />
    </>
  );
}
