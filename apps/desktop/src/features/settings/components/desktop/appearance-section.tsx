import { useShallow } from "zustand/react/shallow";

import charcoalIcon from "@/assets/app-icons/charcoal.png";
import forestIcon from "@/assets/app-icons/forest.png";
import garnetIcon from "@/assets/app-icons/garnet.png";
import glassIcon from "@/assets/app-icons/glass.png";
import glassXlIcon from "@/assets/app-icons/glass-xl.png";
import iceIcon from "@/assets/app-icons/ice.png";
import paperIcon from "@/assets/app-icons/paper.png";
import steelIcon from "@/assets/app-icons/steel.png";
import stoneIcon from "@/assets/app-icons/stone.png";
import stoneXlIcon from "@/assets/app-icons/stone-xl.png";
import {
  type AppIconId,
  useAppIcon,
} from "@/app/state/app-icon-store";
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
import { cn } from "@/shared/lib/utils";
import type { NotesListMode, ThemeMode } from "@typenotes/shared/types";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  SettingsCard,
  SettingsErrorText,
  SettingsField,
  SettingsSection,
  SettingsSelect,
} from "../settings-ui";

const APP_ICON_OPTIONS: Array<{
  id: AppIconId;
  label: string;
  src: string;
}> = [
  { id: "stone", label: "Stone", src: stoneIcon },
  { id: "stone-xl", label: "Stone — Large", src: stoneXlIcon },
  { id: "glass", label: "Glass", src: glassIcon },
  { id: "glass-xl", label: "Glass — Large", src: glassXlIcon },
  { id: "paper", label: "Paper", src: paperIcon },
  { id: "forest", label: "Forest", src: forestIcon },
  { id: "garnet", label: "Garnet", src: garnetIcon },
  { id: "ice", label: "Ice", src: iceIcon },
  { id: "charcoal", label: "Charcoal", src: charcoalIcon },
  { id: "steel", label: "Steel", src: steelIcon },
];

const COLOR_FIELDS: Array<{ id: DesignColorId; label: string }> = [
  { id: "background", label: "Background" },
  { id: "text", label: "Text" },
  { id: "muted", label: "Muted text" },
  { id: "border", label: "Dividers" },
  { id: "selection", label: "Selection" },
];

export function SettingsAppearanceSection() {
  const {
    appIcon,
    applyingIcon,
    appIconError,
    setAppIcon,
  } = useAppIcon(
    useShallow((state) => ({
      appIcon: state.appIcon,
      applyingIcon: state.applyingIcon,
      appIconError: state.appIconError,
      setAppIcon: state.setAppIcon,
    }))
  );
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
        title="App icon"
        description="Choose the icon shown in the macOS Dock and app switcher. This preference stays on this device."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {APP_ICON_OPTIONS.map((option) => {
            const selected = option.id === appIcon;
            const applying = option.id === applyingIcon;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                disabled={applyingIcon !== null}
                className={cn(
                  "group grid gap-2 rounded-lg border bg-background/40 p-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-70",
                  selected
                    ? "border-foreground/50 ring-1 ring-foreground/20"
                    : "border-border/60"
                )}
                onClick={() => {
                  void setAppIcon(option.id).catch(() => {});
                }}
              >
                <img
                  src={option.src}
                  alt=""
                  className="aspect-square w-full select-none object-contain"
                  draggable={false}
                />
                <span className="flex items-center justify-between gap-2 px-1 text-xs font-medium text-foreground">
                  {option.label}
                  {applying ? (
                    <span className="text-muted-foreground">Applying…</span>
                  ) : selected ? (
                    <span className="text-muted-foreground">Selected</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        {appIconError ? (
          <SettingsErrorText>{appIconError}</SettingsErrorText>
        ) : null}
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
