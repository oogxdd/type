// Git sync for the active working folder — fully compatible with the desktop
// app: same libgit2 core, same .type/settings.json, same conflict rule
// (conflicts keep local and write the remote as a .conflict.md sibling).

import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
} from "@typenotes/shared/format";

import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { Button, Field, InlineNote, Section } from "../ui/controls";

export const SyncScreen = () => {
  const theme = useTheme();
  const sync = useSyncStore();
  const settingsStore = useSettingsStore();
  const profile = activeProfile(settingsStore.snapshot);

  const [remoteUrl, setRemoteUrl] = useState(profile?.settings.git_remote_url ?? "");
  const [branch, setBranch] = useState(profile?.settings.git_branch ?? "main");
  const [username, setUsername] = useState(profile?.settings.git_username ?? "");
  const [password, setPassword] = useState(profile?.settings.git_password ?? "");
  const [sshKey, setSshKey] = useState<string | null>(null);

  useEffect(() => {
    void sync.refresh().catch(() => {});
    void core.getSshPublicKey().then(setSshKey).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = sync.action !== "idle";
  const status = sync.status;

  const connect = async () => {
    try {
      await settingsStore.saveGitSettings({
        remoteUrl,
        branch,
        username,
        password,
        commitMessage: profile?.settings.git_commit_message ?? "Sync notes",
      });
      await sync.connect({
        remote_url: remoteUrl,
        branch,
        username: username || null,
        password: password || null,
      });
    } catch {
      // surfaced via store error state
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={sync.action === "refresh"}
          onRefresh={() => void sync.refresh().catch(() => {})}
        />
      }
    >
      <Section title="Status">
        {status ? (
          <View style={styles.statusGrid}>
            <StatusLine label="Repository" value={status.repo_initialized ? "connected" : "not connected"} />
            <StatusLine label="Remote" value={status.remote_url ?? "—"} />
            <StatusLine label="Branch" value={status.current_branch ?? "—"} />
            <StatusLine
              label="Changes"
              value={status.has_uncommitted_changes ? "uncommitted changes" : "clean"}
            />
            <StatusLine label="Ahead / behind" value={`${status.ahead} / ${status.behind}`} />
          </View>
        ) : (
          <InlineNote>Pull to refresh status.</InlineNote>
        )}
        <View style={styles.buttonRow}>
          <View style={styles.buttonGrow}>
            <Button title="Pull" onPress={() => void sync.pull().catch(() => {})} disabled={busy} />
          </View>
          <View style={styles.buttonGrow}>
            <Button title="Push" onPress={() => void sync.push().catch(() => {})} disabled={busy} />
          </View>
        </View>
        {sync.error ? (
          <Text style={{ color: theme.colors.danger }}>{sync.error}</Text>
        ) : null}
        {sync.hint ? <InlineNote>{sync.hint}</InlineNote> : null}
      </Section>

      <Section title="Connection">
        <Field label="Remote URL" value={remoteUrl} onChangeText={setRemoteUrl} placeholder="git@github.com:you/notes.git" />
        <Field label="Branch" value={branch} onChangeText={setBranch} />
        <Field label="Username (for https)" value={username} onChangeText={setUsername} />
        <Field label="Password / token" value={password} onChangeText={setPassword} secureTextEntry />
        <Button title="Save & connect" onPress={() => void connect()} disabled={busy || !remoteUrl} />
        <InlineNote>
          git://, ssh:// and https:// remotes are supported. SSH remotes use the
          app key below automatically.
        </InlineNote>
      </Section>

      <Section title="SSH key">
        {sshKey ? (
          <>
            <Text selectable style={[styles.sshKey, { color: theme.colors.text }]}>
              {sshKey}
            </Text>
            <InlineNote>
              Add this key to your git host, then connect via an ssh:// remote.
              Long-press to copy.
            </InlineNote>
            <Button
              title="Delete key"
              kind="danger"
              onPress={() =>
                void core
                  .deleteSshKey()
                  .then(() => setSshKey(null))
                  .catch(() => {})
              }
            />
          </>
        ) : (
          <Button
            title="Generate key"
            kind="secondary"
            onPress={() => void core.generateSshKey().then(setSshKey).catch((error) => {
              useSyncStore.setState({ error: getErrorMessage(error) });
            })}
          />
        )}
      </Section>

      <Section title="History">
        {sync.history.length === 0 ? (
          <InlineNote>No commits yet.</InlineNote>
        ) : (
          sync.history.map((entry) => (
            <View key={entry.id} style={[styles.commit, { borderBottomColor: theme.colors.border }]}>
              <Text style={{ color: theme.colors.text }} numberOfLines={1}>
                {formatCommitSummaryForApp(entry.summary)}
              </Text>
              <Text style={[styles.commitMeta, { color: theme.colors.secondaryText }]}>
                {formatGitCommitTime(entry.authored_ms)} · {formatGitCommitStateLabel(entry.sync_state)}
                {entry.is_head ? " · HEAD" : ""}
              </Text>
            </View>
          ))
        )}
      </Section>
    </ScrollView>
  );
};

const StatusLine = ({ label, value }: { label: string; value: string }) => {
  const theme = useTheme();
  return (
    <View style={styles.statusLine}>
      <Text style={[styles.statusLabel, { color: theme.colors.secondaryText }]}>{label}</Text>
      <Text style={[styles.statusValue, { color: theme.colors.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  statusGrid: { gap: 6 },
  statusLine: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  statusLabel: { fontSize: 13 },
  statusValue: { fontSize: 13, fontWeight: "500", flexShrink: 1 },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonGrow: { flex: 1 },
  sshKey: { fontSize: 12, fontFamily: "Courier" },
  commit: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  commitMeta: { fontSize: 12 },
});
