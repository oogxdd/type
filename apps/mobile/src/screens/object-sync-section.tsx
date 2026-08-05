import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import type { ObjectStoreSettings } from "@typenotes/shared/types";

import { useObjectSyncStore } from "../state/object-sync-store";
import { useTheme } from "../theme";
import { Button, Field, InlineNote, Section } from "../ui/controls";

/** Cloud-sync setup and state, rendered inside the Sync screen.
 *
 * Once a bucket is configured this screen is mostly informational — the core's
 * scheduler syncs on its own. "Sync now" exists for when you don't want to
 * wait for the debounce.
 */
export function ObjectSyncSection() {
  const theme = useTheme();
  const {
    available,
    status,
    settings,
    busy,
    error,
    notice,
    refresh,
    save,
    test,
    syncNow,
    unlockEncryption,
  } = useObjectSyncStore();
  const [form, setForm] = useState<ObjectStoreSettings | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [passphrase, setPassphrase] = useState("");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Adopt what the core reports until the user starts editing, so the fields
  // show the real stored values (including the prefix the core defaulted).
  useEffect(() => {
    if (!form) setForm(settings);
  }, [form, settings]);

  if (!available) {
    return null;
  }

  const current = form ?? settings;
  const update = <K extends keyof ObjectStoreSettings>(
    key: K,
    value: ObjectStoreSettings[K]
  ) => setForm({ ...current, [key]: value });

  const lastSynced = status?.last_synced_ms
    ? new Date(status.last_synced_ms).toLocaleString()
    : "Never";
  const state = !status?.configured
    ? "Not configured"
    : status.needs_passphrase
      ? "Needs secret phrase"
      : status.syncing
        ? "Syncing..."
        : status.last_error
          ? "Error"
          : status.pending
            ? "Pending"
            : "Idle";

  return (
    <Section title="Cloud sync">
      <View style={styles.statusRow}>
        <Text style={[styles.statusLabel, { color: theme.colors.secondaryText }]}>Status</Text>
        <Text style={[styles.statusValue, { color: theme.colors.text }]} numberOfLines={1}>
          {state}
        </Text>
      </View>
      <View style={styles.statusRow}>
        <Text style={[styles.statusLabel, { color: theme.colors.secondaryText }]}>Last sync</Text>
        <Text style={[styles.statusValue, { color: theme.colors.text }]} numberOfLines={1}>
          {lastSynced}
        </Text>
      </View>

      {status?.last_error ? (
        <Text style={{ color: theme.colors.danger }}>{status.last_error}</Text>
      ) : null}
      {error ? <Text style={{ color: theme.colors.danger }}>{error}</Text> : null}
      {notice ? <Text style={{ color: theme.colors.success }}>{notice}</Text> : null}

      <View style={styles.switchRow}>
        <Text style={{ color: theme.colors.text }}>Sync automatically</Text>
        <Switch
          value={current.enabled}
          onValueChange={(value) => {
            const next = { ...current, enabled: value };
            setForm(next);
            void save(next);
          }}
          disabled={busy || !status?.configured}
        />
      </View>

      <View style={styles.actions}>
        <Button
          title={busy ? "Working..." : "Sync now"}
          onPress={() => void syncNow()}
          disabled={busy || !status?.configured}
        />
        <Button
          title={expanded ? "Hide setup" : "Setup"}
          kind="secondary"
          onPress={() => setExpanded((value) => !value)}
        />
      </View>

      {status?.needs_passphrase ? (
        <>
          <InlineNote>
            This bucket is end-to-end encrypted. Enter the same secret phrase
            you set on the desktop — or scan the pairing QR from desktop
            Settings → Sync, which brings the key with it and needs no typing.
          </InlineNote>
          <Field
            label="Secret phrase"
            value={passphrase}
            secureTextEntry
            onChangeText={setPassphrase}
          />
          <View style={styles.actions}>
            <Button
              title={busy ? "Unlocking..." : "Unlock"}
              onPress={() => {
                void unlockEncryption(passphrase);
                setPassphrase("");
              }}
              disabled={busy || passphrase.trim() === ""}
            />
          </View>
        </>
      ) : null}

      {expanded ? (
        <>
          <InlineNote>
            Scanning the pairing QR from desktop Settings → Sync fills all of
            this in at once. Otherwise, point it at a bucket you own
            (Cloudflare R2, Backblaze B2, S3, MinIO). Keys are stored on this
            device only and never uploaded.
          </InlineNote>
          <Field
            label="Endpoint"
            value={current.endpoint}
            placeholder="https://<account>.r2.cloudflarestorage.com"
            onChangeText={(value) => update("endpoint", value)}
          />
          <Field
            label="Bucket"
            value={current.bucket}
            onChangeText={(value) => update("bucket", value)}
          />
          <Field
            label="Region"
            value={current.region}
            placeholder="auto"
            onChangeText={(value) => update("region", value)}
          />
          <Field
            label="Access key ID"
            value={current.access_key_id}
            onChangeText={(value) => update("access_key_id", value)}
          />
          <Field
            label="Secret access key"
            value={current.secret_access_key}
            secureTextEntry
            onChangeText={(value) => update("secret_access_key", value)}
          />
          <Field
            label="Prefix"
            value={current.prefix}
            placeholder="type-notes/<profile>"
            onChangeText={(value) => update("prefix", value)}
          />
          <View style={styles.actions}>
            <Button
              title="Save"
              onPress={() => void save(current)}
              disabled={busy}
            />
            <Button
              title="Test connection"
              kind="secondary"
              onPress={() => void test(current)}
              disabled={busy}
            />
          </View>
        </>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 4,
  },
  statusLabel: { fontSize: 13 },
  statusValue: { fontSize: 13, flexShrink: 1, textAlign: "right" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", paddingTop: 8 },
});
