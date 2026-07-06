import { useNotesTree } from "@/features/notes/navigation/state/notes-tree-context";
import { useAppleImport } from "@/features/import/hooks/use-apple-import";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsErrorText,
  SettingsField,
  SettingsHelpText,
  SettingsSection,
} from "../settings-ui";

export function SettingsImportSection() {
  const { refreshTree } = useNotesTree();
  const {
    phase,
    sourcePath,
    scan,
    mode,
    setMode,
    targetFolder,
    setTargetFolder,
    status,
    error,
    pickFolder,
    startImport,
    reset,
  } = useAppleImport({ onImported: () => void refreshTree() });

  const importing = phase === "importing";
  const percent =
    status && status.total > 0
      ? Math.min(100, Math.round((status.processed / status.total) * 100))
      : 0;

  return (
    <SettingsSection
      title="Import"
      description="Bring in notes exported from Apple Notes, preserving their folders and original dates."
    >
      <SettingsCard title="Apple Notes folder">
        <SettingsHelpText>
          Apple Notes has no bulk export. On a Mac, export your notes to a folder
          of files — for example with the free <strong>Exporter</strong> app — then
          choose that folder here. Markdown, plain-text, and HTML notes are all
          supported; attachments and images are skipped.
        </SettingsHelpText>
        <SettingsActionRow>
          <Button type="button" size="sm" onClick={() => void pickFolder()} disabled={importing}>
            {sourcePath ? "Choose a different folder…" : "Choose folder…"}
          </Button>
          {sourcePath ? (
            <code className="break-all text-xs text-muted-foreground">{sourcePath}</code>
          ) : (
            <span className="text-xs text-muted-foreground">No folder selected</span>
          )}
        </SettingsActionRow>
        {phase === "scanning" ? (
          <SettingsHelpText>Scanning folder…</SettingsHelpText>
        ) : null}
      </SettingsCard>

      {scan ? (
        <SettingsCard
          title={`Found ${scan.note_count} ${scan.note_count === 1 ? "note" : "notes"}${
            scan.folder_count > 0
              ? ` across ${scan.folder_count} ${scan.folder_count === 1 ? "folder" : "folders"}`
              : ""
          }`}
        >
          {scan.sample_titles.length > 0 ? (
            <SettingsHelpText>
              e.g. {scan.sample_titles.join(", ")}…
            </SettingsHelpText>
          ) : null}
          {scan.skipped_files > 0 ? (
            <SettingsHelpText>
              {scan.skipped_files} non-text {scan.skipped_files === 1 ? "file" : "files"}{" "}
              (attachments/images) will be skipped.
            </SettingsHelpText>
          ) : null}

          <div className="grid gap-2 pt-1">
            <span className="text-sm font-medium text-foreground">How to import</span>
            <label className="inline-flex items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="apple-import-mode"
                className="mt-1 h-4 w-4 border-border"
                checked={mode === "preserve"}
                onChange={() => setMode("preserve")}
                disabled={importing}
              />
              <span>
                <span className="font-medium">Preserve folder structure</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  Recreate the Apple Notes folders inside one folder in your notes.
                </span>
              </span>
            </label>
            <label className="inline-flex items-start gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="apple-import-mode"
                className="mt-1 h-4 w-4 border-border"
                checked={mode === "flatten"}
                onChange={() => setMode("flatten")}
                disabled={importing}
              />
              <span>
                <span className="font-medium">Flatten everything into Feed</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  Drop every note straight into Feed, discarding the folders.
                </span>
              </span>
            </label>
          </div>

          {mode === "preserve" ? (
            <SettingsField label="Import into folder">
              <Input
                type="text"
                value={targetFolder}
                onChange={(event) => setTargetFolder(event.target.value)}
                placeholder={scan.source_name}
                disabled={importing}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </SettingsField>
          ) : null}

          <SettingsActionRow>
            <Button
              type="button"
              size="sm"
              onClick={() => void startImport()}
              disabled={importing || scan.note_count === 0}
            >
              {importing ? "Importing…" : "Start import"}
            </Button>
            {phase === "done" || phase === "error" ? (
              <Button type="button" size="sm" variant="secondary" onClick={reset}>
                Import another folder
              </Button>
            ) : null}
          </SettingsActionRow>
        </SettingsCard>
      ) : null}

      {status && (importing || phase === "done") ? (
        <SettingsCard title={phase === "done" ? "Import complete" : "Importing…"}>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {status.processed} / {status.total}
            </span>
            <span>{percent}%</span>
          </div>
          {importing && status.current ? (
            <p className="truncate text-xs text-muted-foreground">{status.current}</p>
          ) : null}
          <SettingsHelpText>
            Imported {status.imported}
            {status.failed > 0 ? ` · ${status.failed} failed` : ""}
            {status.folders_created > 0 ? ` · ${status.folders_created} folders` : ""}
            {status.target_folder ? ` → ${status.target_folder}` : ""}
          </SettingsHelpText>
          {phase === "done" && status.errors.length > 0 ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer text-destructive">
                {status.failed} failed
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {status.errors.map((message, index) => (
                  <li key={index} className="break-all">
                    {message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </SettingsCard>
      ) : null}

      {error ? <SettingsErrorText>{error}</SettingsErrorText> : null}
    </SettingsSection>
  );
}
