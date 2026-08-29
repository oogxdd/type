import { useShallow } from "zustand/react/shallow";

import {
  DESIGN_FONT_OPTIONS,
  type DesignColorId,
  type DesignFontId,
  useAppearance,
} from "@/app/state/appearance-store";
import {
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
} from "@/shared/constants";
import type { NotesListMode, ThemeMode } from "@typenotes/shared/types";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  SettingsCard,
  SettingsField,
  SettingsSection,
  SettingsSelect,
} from "../settings-ui";

const COLOR_FIELDS: Array<{ id: DesignColorId; label: string }> = [
  { id: "background", label: "Background" },
  { id: "text", label: "Text" },
  { id: "muted", label: "Muted text" },
  { id: "border", label: "Dividers" },
  { id: "selection", label: "Selection" },
];

export function SettingsAppearanceSection() {
  const {
    theme,
    setTheme,
    notesListMode,
    setNotesListMode,
    hideArchivedFeedNotes,
    setHideArchivedFeedNotes,
    editorFontSize,
    setEditorFontSize,
    showVimModeIndicator,
    setShowVimModeIndicator,
    designFont,
    setDesignFont,
    designPalettes,
    setDesignColor,
    resetDesignPalette,
  } = useAppearance(
    useShallow((state) => ({
      theme: state.theme,
      setTheme: state.setTheme,
      notesListMode: state.notesListMode,
      setNotesListMode: state.setNotesListMode,
      hideArchivedFeedNotes: state.hideArchivedFeedNotes,
      setHideArchivedFeedNotes: state.setHideArchivedFeedNotes,
      editorFontSize: state.editorFontSize,
      setEditorFontSize: state.setEditorFontSize,
      showVimModeIndicator: state.showVimModeIndicator,
      setShowVimModeIndicator: state.setShowVimModeIndicator,
      designFont: state.designFont,
      setDesignFont: state.setDesignFont,
      designPalettes: state.designPalettes,
      setDesignColor: state.setDesignColor,
      resetDesignPalette: state.resetDesignPalette,
    }))
  );

  const activePalette = designPalettes[theme];

  return (
    <SettingsSection title="Appearance" description="Theme and navigation layout.">
      <SettingsCard title="Theme">
        <SettingsField label="Theme mode">
          <SettingsSelect
            value={theme}
            onChange={(event) => setTheme(event.target.value as ThemeMode)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </SettingsSelect>
        </SettingsField>
      </SettingsCard>

      <SettingsCard
        title="Editor navigation"
        description="The editor always keeps Vim-style Normal, Insert, and Visual modes."
      >
        <label className="flex items-start gap-3 rounded-md border border-border/50 bg-background/40 p-3 text-sm">
          <Checkbox
            checked={showVimModeIndicator}
            onCheckedChange={(checked) =>
              setShowVimModeIndicator(Boolean(checked))
            }
            className="mt-0.5"
          />
          <span className="grid gap-1">
            <span className="font-medium text-foreground">Show mode label</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Display NORMAL, INSERT, or VISUAL in the editor corner.
            </span>
          </span>
        </label>
      </SettingsCard>

      <SettingsCard
        title="Typography"
        description="Used throughout the desktop interface and note editor."
      >
        <SettingsField label="Font family">
          <SettingsSelect
            value={designFont}
            onChange={(event) => setDesignFont(event.target.value as DesignFontId)}
          >
            {DESIGN_FONT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SettingsSelect>
        </SettingsField>

        <SettingsField label={`Editor text size — ${editorFontSize}px`}>
          <input
            type="range"
            min={MIN_EDITOR_FONT_SIZE}
            max={MAX_EDITOR_FONT_SIZE}
            step={1}
            value={editorFontSize}
            onChange={(event) => setEditorFontSize(Number(event.target.value))}
            className="w-full accent-foreground"
          />
        </SettingsField>
      </SettingsCard>

      <SettingsCard
        title={`${theme === "light" ? "Light" : "Dark"} palette`}
        description="These colors apply immediately to the active theme."
      >
        <div className="settings-color-grid">
          {COLOR_FIELDS.map((field) => (
            <label className="settings-color-field" key={field.id}>
              <span>{field.label}</span>
              <span className="settings-color-control">
                <input
                  type="color"
                  value={activePalette[field.id]}
                  onChange={(event) =>
                    setDesignColor(theme, field.id, event.target.value)
                  }
                  aria-label={`${field.label} color`}
                />
                <code>{activePalette[field.id]}</code>
              </span>
            </label>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => resetDesignPalette(theme)}
        >
          Reset {theme} palette
        </Button>
      </SettingsCard>

      <SettingsCard title="Notes list">
        <SettingsField label="Display mode" hint="Desktop only.">
          <SettingsSelect
            value={notesListMode}
            onChange={(event) =>
              setNotesListMode(event.target.value as NotesListMode)
            }
          >
            <option value="separate">Separate notes panel</option>
            <option value="nested">Inside folders navigation</option>
          </SettingsSelect>
        </SettingsField>

        <label className="flex items-start gap-3 rounded-md border border-border/50 bg-background/40 p-3 text-sm">
          <Checkbox
            checked={hideArchivedFeedNotes}
            onCheckedChange={(checked) =>
              setHideArchivedFeedNotes(Boolean(checked))
            }
            className="mt-0.5"
          />
          <span className="grid gap-1">
            <span className="font-medium text-foreground">Hide archived feed notes</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Archived notes stay in Feed, but they are hidden from the main list.
            </span>
          </span>
        </label>
      </SettingsCard>
    </SettingsSection>
  );
}
