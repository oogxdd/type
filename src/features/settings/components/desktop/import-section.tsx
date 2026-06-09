import { useNotesTree } from "@/features/notes/tree/hooks/notes-tree-context";
import { useAppleImport } from "@/features/import/hooks/use-apple-import";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

const cardClass = "space-y-3 rounded-lg border border-border/70 bg-card/30 p-4";

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
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Import</h2>
        <p className="text-sm text-muted-foreground">
          Bring in notes exported from Apple Notes, preserving their folders and
          original dates.
        </p>
      </div>

      <section className={cardClass}>
        <h3 className="text-sm font-semibold text-foreground">Apple Notes folder</h3>
        <p className="text-xs text-muted-foreground">
          Apple Notes has no bulk export. On a Mac, export your notes to a folder
          of files — for example with the free <strong>Exporter</strong> app — then
          choose that folder here. Markdown, plain-text, and HTML notes are all
          supported; attachments and images are skipped.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => void pickFolder()} disabled={importing}>
            {sourcePath ? "Choose a different folder…" : "Choose folder…"}
          </Button>
          {sourcePath ? (
            <code className="text-xs break-all text-muted-foreground">{sourcePath}</code>
          ) : (
            <span className="text-xs text-muted-foreground">No folder selected</span>
          )}
        </div>
        {phase === "scanning" ? (
          <p className="text-xs text-muted-foreground">Scanning folder…</p>
        ) : null}
      </section>

      {scan ? (
        <section className={cardClass}>
          <h3 className="text-sm font-semibold text-foreground">
            Found {scan.note_count} {scan.note_count === 1 ? "note" : "notes"}
            {scan.folder_count > 0
              ? ` across ${scan.folder_count} ${scan.folder_count === 1 ? "folder" : "folders"}`
              : ""}
          </h3>
          {scan.sample_titles.length > 0 ? (
            <p className="text-xs text-muted-foreground break-all">
              e.g. {scan.sample_titles.join(", ")}…
            </p>
          ) : null}
          {scan.skipped_files > 0 ? (
            <p className="text-xs text-muted-foreground">
              {scan.skipped_files} non-text {scan.skipped_files === 1 ? "file" : "files"}{" "}
              (attachments/images) will be skipped.
            </p>
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
                <span className="block text-xs text-muted-foreground">
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
                <span className="block text-xs text-muted-foreground">
                  Drop every note straight into Feed, discarding the folders.
                </span>
              </span>
            </label>
          </div>

          {mode === "preserve" ? (
            <label className="grid gap-2 text-sm">
              <span className="text-sm font-medium text-foreground">Import into folder</span>
              <Input
                type="text"
                value={targetFolder}
                onChange={(event) => setTargetFolder(event.target.value)}
                placeholder={scan.source_name}
                disabled={importing}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
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
          </div>
        </section>
      ) : null}

      {status && (importing || phase === "done") ? (
        <section className={cardClass}>
          <h3 className="text-sm font-semibold text-foreground">
            {phase === "done" ? "Import complete" : "Importing…"}
          </h3>
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
          <p className="text-xs text-muted-foreground">
            Imported {status.imported}
            {status.failed > 0 ? ` · ${status.failed} failed` : ""}
            {status.folders_created > 0 ? ` · ${status.folders_created} folders` : ""}
            {status.target_folder ? ` → ${status.target_folder}` : ""}
          </p>
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
        </section>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
