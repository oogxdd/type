import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { NoteRow } from "@/components/notes-list/note-row";
import { SettingsMiddlePane } from "@/components/settings/settings-panel";
import type { SettingsSectionId } from "@/lib/settings-sections";

import { focusNoScroll } from "@/lib/dom";
import type { AppMode } from "@typenotes/shared/types";

type MiddlePaneProps = {
  appMode: AppMode;
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (id: SettingsSectionId) => void;
  notesPanelRef: RefObject<HTMLDivElement | null>;
  middlePaneRef: RefObject<HTMLDivElement | null>;
  lastLeftPaneFocusRef: RefObject<string>;
  notesTitle: string;
  notes: Array<{ path: string; name: string }>;
  notePreviews: Record<string, import("@typenotes/shared/format").NotePreview>;
  selectedNotes: Set<string>;
  onNotesKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onNoteClick: (notePath: string, event: ReactMouseEvent, parentPath?: string) => void;
  onNoteContextMenu: (event: ReactMouseEvent, path: string, parentPath?: string) => void;
};

export function MiddlePane({
  appMode,
  activeSettingsSection,
  onSettingsSectionChange,
  notesPanelRef,
  middlePaneRef,
  lastLeftPaneFocusRef,
  notesTitle,
  notes,
  notePreviews,
  selectedNotes,
  onNotesKeyDown,
  onNoteClick,
  onNoteContextMenu,
}: MiddlePaneProps) {
  if (appMode === "notes") {
    return (
      <div className="pane notes-pane min-w-0">
        <div className="pane-drag-region" data-tauri-drag-region aria-hidden />
        <div
          className="pane-body focus:outline-none"
          ref={(node) => {
            notesPanelRef.current = node;
            middlePaneRef.current = node;
          }}
          tabIndex={0}
          onKeyDown={onNotesKeyDown}
          onClick={() => {
            lastLeftPaneFocusRef.current = "middle";
            focusNoScroll(middlePaneRef.current);
          }}
        >
          {notes.length === 0 && <div className="empty">No notes in {notesTitle}</div>}
          <SortableContext
            items={notes.map((n) => n.path)}
            strategy={verticalListSortingStrategy}
          >
            {notes.map((note) => (
              <NoteRow
                key={note.path}
                note={note}
                preview={notePreviews[note.path]}
                isSelected={selectedNotes.has(note.path)}
                onClick={onNoteClick}
                onContextMenu={onNoteContextMenu}
              />
            ))}
          </SortableContext>
        </div>
      </div>
    );
  }

  return (
    <SettingsMiddlePane
      activeSection={activeSettingsSection}
      onSectionChange={onSettingsSectionChange}
      middlePaneRef={middlePaneRef}
      onPaneClick={() => {
        lastLeftPaneFocusRef.current = "middle";
        focusNoScroll(middlePaneRef.current);
      }}
    />
  );
}
