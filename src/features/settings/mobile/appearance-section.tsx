import { useTheme } from "@/contexts/ThemeContext";
import type { NotesListMode, ThemeMode } from "@/types";

export function MobileAppearanceSection() {
  const { theme, setTheme, notesListMode, setNotesListMode } = useTheme();

  return (
    <div className="flex flex-col gap-6 px-4 py-2">
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Theme
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <ThemeOption
            label="Light"
            value="light"
            current={theme}
            onSelect={setTheme}
          />
          <ThemeOption
            label="Dark"
            value="dark"
            current={theme}
            onSelect={setTheme}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Notes list
        </legend>
        <div className="flex flex-col gap-2">
          <ListModeOption
            label="Separate panel"
            description="Notes in their own pane"
            value="separate"
            current={notesListMode}
            onSelect={setNotesListMode}
          />
          <ListModeOption
            label="Nested in folders"
            description="Notes shown under folders"
            value="nested"
            current={notesListMode}
            onSelect={setNotesListMode}
          />
        </div>
        <p className="mt-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          Desktop only.
        </p>
      </fieldset>
    </div>
  );
}

function ThemeOption({
  label,
  value,
  current,
  onSelect,
}: {
  label: string;
  value: ThemeMode;
  current: ThemeMode;
  onSelect: (v: ThemeMode) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={selected}
      className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
        selected
          ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
          : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
      }`}
    >
      {label}
    </button>
  );
}

function ListModeOption({
  label,
  description,
  value,
  current,
  onSelect,
}: {
  label: string;
  description: string;
  value: NotesListMode;
  current: NotesListMode;
  onSelect: (v: NotesListMode) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={selected}
      className={`flex flex-col items-start rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
        selected
          ? "border-neutral-400 bg-neutral-50 dark:border-neutral-500 dark:bg-neutral-800"
          : "border-transparent bg-neutral-100 dark:bg-neutral-800/50"
      }`}
    >
      <span className={`text-sm font-medium ${
        selected
          ? "text-neutral-900 dark:text-neutral-100"
          : "text-neutral-600 dark:text-neutral-400"
      }`}>
        {label}
      </span>
      <span className="text-xs text-neutral-400 dark:text-neutral-500">
        {description}
      </span>
    </button>
  );
}
