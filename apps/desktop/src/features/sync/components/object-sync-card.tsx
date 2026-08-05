import { useCallback, useEffect, useRef, useState } from "react";
import * as objectSyncApi from "@/features/sync/api/object-sync-api";
import type {
  ObjectStoreSettings,
  ObjectSyncStatus,
} from "@typenotes/shared/types";
import { getErrorMessage } from "@typenotes/shared/errors";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsCheckRow,
  SettingsErrorText,
  SettingsField,
  SettingsHelpText,
  SettingsInfoGrid,
  SettingsInfoRow,
} from "@/features/settings/components/settings-ui";

/** Poll while the settings page is open so a background round's result shows
 *  up without the user pressing anything. */
const STATUS_POLL_MS = 4000;

const EMPTY_SETTINGS: ObjectStoreSettings = {
  endpoint: "",
  bucket: "",
  prefix: "",
  region: "auto",
  access_key_id: "",
  secret_access_key: "",
  force_path_style: null,
  device_id: "",
  enabled: false,
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const describeStatus = (status: ObjectSyncStatus | null): string => {
  if (!status) return "Loading...";
  if (!status.configured) return "Not configured";
  if (status.needs_passphrase) return "Needs secret phrase";
  if (status.syncing) return "Syncing...";
  if (status.last_error) return "Error";
  if (status.pending) return "Pending";
  return "Idle";
};

export function ObjectSyncCard() {
  const [status, setStatus] = useState<ObjectSyncStatus | null>(null);
  const [form, setForm] = useState<ObjectStoreSettings>(EMPTY_SETTINGS);
  const [busy, setBusy] = useState<null | "save" | "test" | "sync" | "gc">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Don't stomp on what the user is typing when a poll lands.
  const editingRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await objectSyncApi.getObjectSyncStatus());
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [loaded, current] = await Promise.all([
          objectSyncApi.getObjectSyncSettings(),
          objectSyncApi.getObjectSyncStatus(),
        ]);
        if (!editingRef.current) setForm(loaded);
        setStatus(current);
      } catch (caught) {
        setError(getErrorMessage(caught));
      }
    })();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  const update = <K extends keyof ObjectStoreSettings>(
    key: K,
    value: ObjectStoreSettings[K]
  ) => {
    editingRef.current = true;
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const run = async (
    kind: NonNullable<typeof busy>,
    action: () => Promise<string | null>
  ) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(null);
      void refreshStatus();
    }
  };

  const save = () =>
    run("save", async () => {
      const next = await objectSyncApi.setObjectSyncSettings(form);
      setStatus(next);
      editingRef.current = false;
      // The core assigns the device id and default prefix; read them back so
      // the form shows what was actually stored.
      setForm(await objectSyncApi.getObjectSyncSettings());
      return "Saved.";
    });

  const test = () =>
    run("test", async () => {
      await objectSyncApi.testObjectSyncConnection(form);
      return "Connection works.";
    });

  const syncNow = () =>
    run("sync", async () => {
      const outcome = await objectSyncApi.objectSyncNow();
      const parts = [
        `${outcome.uploaded} up`,
        `${outcome.downloaded} down`,
        formatBytes(outcome.bytes_uploaded + outcome.bytes_downloaded),
      ];
      if (outcome.conflicts.length > 0) {
        parts.push(`${outcome.conflicts.length} conflict copies`);
      }
      return parts.join(" · ");
    });

  const collectGarbage = () =>
    run("gc", async () => {
      const removed = await objectSyncApi.collectObjectSyncGarbage();
      return `Removed ${removed} unreferenced object${removed === 1 ? "" : "s"}.`;
    });

  const lastSynced = status?.last_synced_ms
    ? new Date(status.last_synced_ms).toLocaleString()
    : "Never";
  const skipped = status?.last_outcome?.skipped ?? [];

  return (
    <SettingsCard title="Cloud sync (S3-compatible)">
      <SettingsHelpText>
        Syncs this working folder through a bucket you own — Cloudflare R2,
        Backblaze B2, AWS S3, MinIO. Once configured, sync runs on its own; the
        button below is only for when you don't want to wait. Credentials stay
        on this device and are never uploaded.
      </SettingsHelpText>

      <SettingsInfoGrid>
        <SettingsInfoRow label="Status">
          <code className="text-xs">{describeStatus(status)}</code>
        </SettingsInfoRow>
        <SettingsInfoRow label="Last sync">
          <code className="text-xs">{lastSynced}</code>
        </SettingsInfoRow>
        <SettingsInfoRow label="Tracked files">
          <code className="text-xs">{status?.tracked_files ?? 0}</code>
        </SettingsInfoRow>
        {status?.device_id ? (
          <SettingsInfoRow label="This device">
            <code className="text-xs">{status.device_id.slice(0, 12)}</code>
          </SettingsInfoRow>
        ) : null}
      </SettingsInfoGrid>

      {status?.last_error ? (
        <SettingsErrorText>{status.last_error}</SettingsErrorText>
      ) : null}
      {error ? <SettingsErrorText>{error}</SettingsErrorText> : null}
      {notice ? <SettingsHelpText>{notice}</SettingsHelpText> : null}
      {skipped.length > 0 ? (
        <SettingsErrorText>
          Skipped: {skipped.join("; ")}
        </SettingsErrorText>
      ) : null}

      <SettingsField
        label="Endpoint"
        hint="e.g. https://<account>.r2.cloudflarestorage.com"
      >
        <Input
          value={form.endpoint}
          placeholder="https://..."
          onChange={(event) => update("endpoint", event.target.value)}
        />
      </SettingsField>

      <SettingsField label="Bucket">
        <Input
          value={form.bucket}
          onChange={(event) => update("bucket", event.target.value)}
        />
      </SettingsField>

      <SettingsField
        label="Region"
        hint="Cloudflare R2 uses auto; S3 and B2 need their real region."
      >
        <Input
          value={form.region}
          placeholder="auto"
          onChange={(event) => update("region", event.target.value)}
        />
      </SettingsField>

      <SettingsField label="Access key ID">
        <Input
          value={form.access_key_id}
          autoComplete="off"
          onChange={(event) => update("access_key_id", event.target.value)}
        />
      </SettingsField>

      <SettingsField label="Secret access key">
        <Input
          type="password"
          value={form.secret_access_key}
          autoComplete="off"
          onChange={(event) => update("secret_access_key", event.target.value)}
        />
      </SettingsField>

      <SettingsField
        label="Prefix"
        hint="Leave empty to use type-notes/<profile id>, so one bucket can hold several working folders."
      >
        <Input
          value={form.prefix}
          placeholder="type-notes/..."
          onChange={(event) => update("prefix", event.target.value)}
        />
      </SettingsField>

      <SettingsCheckRow
        checked={form.enabled}
        onChange={(checked) => update("enabled", checked)}
        label="Sync this folder automatically"
        description="Uploads on a short delay after each change, and checks for changes from other devices in the background."
      />

      <SettingsActionRow>
        <Button size="sm" type="button" onClick={() => void save()} disabled={busy !== null}>
          {busy === "save" ? "Saving..." : "Save"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => void test()}
          disabled={busy !== null}
        >
          {busy === "test" ? "Testing..." : "Test connection"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => void syncNow()}
          disabled={busy !== null || !status?.configured}
        >
          {busy === "sync" ? "Syncing..." : "Sync now"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => void collectGarbage()}
          disabled={busy !== null || !status?.configured}
          title="Delete stored objects no device refers to any more."
        >
          {busy === "gc" ? "Cleaning..." : "Clean up storage"}
        </Button>
      </SettingsActionRow>
    </SettingsCard>
  );
}
