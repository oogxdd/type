import { useRef, useState, type ChangeEvent } from "react";

import { useTreeInteractions } from "@/app/hooks/use-tree-interactions";
import { useNoteOpener } from "@/app/hooks/use-note-opener";
import { useSelection } from "@/app/state/selection-store";
import { DesktopAppShell } from "@/desktop/desktop-app-shell";
import { CommandPalette } from "@/features/command-palette/components/command-palette";
import { useHandwriting } from "@/features/handwriting/hooks/handwriting-context";
import { useRecordings } from "@/features/recording/hooks/recordings-context";
import type { SettingsSectionId } from "@/features/settings/lib/sections";
import { MobileShell } from "@/mobile/mobile-shell";
import { useLayoutMode } from "@/mobile/use-layout-mode";
import { ARCHIEVE_FOLDER_PATH, FEED_FOLDER_PATH } from "@typenotes/shared/constants";
import type { AppMode } from "@typenotes/shared/types";

export function AppShell() {
  const layoutMode = useLayoutMode();
  const [desktopAppMode, setDesktopAppMode] = useState<AppMode>("notes");
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>("general");
  const handwritingInputRef = useRef<HTMLInputElement | null>(null);
  const mobileFoldersPanelRef = useRef<HTMLDivElement | null>(null);

  const activeFolder = useSelection((state) => state.activeFolder);
  const { isRecordingAudio, startRecording } = useRecordings();
  const { importHandwritingFile } = useHandwriting();
  const { handleNoteContextMenu } = useTreeInteractions({
    foldersPanelRef: mobileFoldersPanelRef,
  });
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
      {layoutMode === "desktop" ? (
        <DesktopAppShell
          appMode={desktopAppMode}
          onAppModeChange={setDesktopAppMode}
          activeSettingsSection={activeSettingsSection}
          onSettingsSectionChange={setActiveSettingsSection}
          onImportHandwriting={() => handwritingInputRef.current?.click()}
          onOpenPinnedFolder={openPinnedFolder}
        />
      ) : (
        <MobileShell
          activeSettingsSection={activeSettingsSection}
          onSettingsSectionChange={setActiveSettingsSection}
          onNoteContextMenu={handleNoteContextMenu}
        />
      )}
    </>
  );
}
