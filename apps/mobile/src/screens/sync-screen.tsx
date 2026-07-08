// Git sync for the active working folder — fully compatible with the desktop
// app: same libgit2 core, same .type/settings.json, same conflict rule
// (conflicts keep local and write the remote as a .conflict.md sibling).
//
// The primary flow is QR-based: the desktop's "Local network server" card
// shows a type2://sync QR; scanning it here (in-app camera, or the system
// camera via the deep link) saves the remote and connects, so syncing is one
// button afterwards.

import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as core from "@typenotes/mobile-core/core-api";
import { getErrorMessage } from "@typenotes/shared/errors";
import {
  formatCommitSummaryForApp,
  formatGitCommitStateLabel,
  formatGitCommitTime,
} from "@typenotes/shared/format";
import { parseSyncDeepLink, type SyncDeepLinkParams } from "@typenotes/shared/sync-link";

import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { Button, Field, InlineNote, Section } from "../ui/controls";
import { PresentationHeader } from "../ui/presentation-header";

const SETUP_STEPS = [
  "Open the Type app on your computer.",
  "In desktop Settings → Sync, press “Start server” (phone and computer on the same Wi-Fi or hotspot).",
  "Tap “Scan QR code” below and point the camera at the code on the computer's screen.",
  "Tap “Sync now”. That's it — repeat “Sync now” whenever you want to sync.",
];

export const SyncScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sync = useSyncStore();
  const settingsStore = useSettingsStore();
  const profile = activeProfile(settingsStore.snapshot);

  const [remoteUrl, setRemoteUrl] = useState(profile?.settings.git_remote_url ?? "");
  const [branch, setBranch] = useState(profile?.settings.git_branch ?? "main");
  const [username, setUsername] = useState(profile?.settings.git_username ?? "");
  const [password, setPassword] = useState(profile?.settings.git_password ?? "");
  const [sshKey, setSshKey] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [connectedVia, setConnectedVia] = useState<string | null>(null);

  // QR scanner state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const handledScanRef = useRef(false);

  useEffect(() => {
    void sync.refresh().catch(() => {});
    void core.getSshPublicKey().then(setSshKey).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyLink = async (link: SyncDeepLinkParams) => {
    setRemoteUrl(link.remote);
    setBranch(link.branch ?? "main");
    try {
      await sync.connectFromLink(link);
      setConnectedVia(link.name ?? link.remote);
    } catch {
      // surfaced via store error state
    }
  };

  // A type2://sync deep link (system camera) lands here via the sync store.
  const pendingLink = useSyncStore((s) => s.pendingLink);
  useEffect(() => {
    if (pendingLink) {
      sync.setPendingLink(null);
      void applyLink(pendingLink);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLink]);

  const openScanner = async () => {
    setScanNotice(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        useSyncStore.setState({
          error: "Camera permission is needed to scan the QR code. Enable it in system settings.",
        });
        return;
      }
    }
    handledScanRef.current = false;
    setScannerOpen(true);
  };

  const onScanned = (data: string) => {
    if (handledScanRef.current) {
      return;
    }
    const link = parseSyncDeepLink(data);
    if (!link) {
      setScanNotice("That QR code is not a Type sync code — look for the one in desktop Settings → Sync.");
      return;
    }
    handledScanRef.current = true;
    setScannerOpen(false);
    void applyLink(link);
  };

  const busy = sync.action !== "idle";
  const status = sync.status;
  const connected = Boolean(status?.repo_initialized && status?.remote_url);

  const connectManually = async () => {
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
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <PresentationHeader title="Sync" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 48 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={sync.action === "refresh"}
            onRefresh={() => void sync.refresh().catch(() => {})}
          />
        }
      >
      {!connected ? (
        <Section title="Sync with your computer">
          {SETUP_STEPS.map((step, index) => (
            <View key={step} style={styles.stepRow}>
              <Text style={[styles.stepNumber, { color: theme.colors.accent }]}>
                {index + 1}
              </Text>
              <Text style={[styles.stepText, { color: theme.colors.text }]}>{step}</Text>
            </View>
          ))}
          <Button title="Scan QR code" onPress={() => void openScanner()} disabled={busy} />
          <InlineNote>
            You can also point the system Camera app at the QR — it opens Type
            and sets everything up the same way.
          </InlineNote>
        </Section>
      ) : null}

      <Section title={connected ? "Sync" : "Status"}>
        {connectedVia ? (
          <Text style={{ color: theme.colors.success }}>
            Connected to {connectedVia}.
          </Text>
        ) : null}
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
        <Button
          title={busy ? "Syncing…" : "Sync now"}
          onPress={() => void sync.syncNow().catch(() => {})}
          disabled={busy || !connected}
        />
        <View style={styles.buttonRow}>
          <View style={styles.buttonGrow}>
            <Button title="Pull only" kind="secondary" onPress={() => void sync.pull().catch(() => {})} disabled={busy || !connected} />
          </View>
          <View style={styles.buttonGrow}>
            <Button title="Push only" kind="secondary" onPress={() => void sync.push().catch(() => {})} disabled={busy || !connected} />
          </View>
        </View>
        {sync.error ? (
          <Text style={{ color: theme.colors.danger }}>{sync.error}</Text>
        ) : null}
        {sync.hint ? <InlineNote>{sync.hint}</InlineNote> : null}
      </Section>

      {connected ? (
        <Section title="Change connection">
          <Button title="Scan a new QR code" kind="secondary" onPress={() => void openScanner()} disabled={busy} />
        </Section>
      ) : null}

      <Section title="Advanced">
        <Pressable onPress={() => setShowManual((v) => !v)} hitSlop={6}>
          <Text style={{ color: theme.colors.accent, fontWeight: "500" }}>
            {showManual ? "Hide manual setup" : "Set up manually (git remote URL)"}
          </Text>
        </Pressable>
        {showManual ? (
          <>
            <Field label="Remote URL" value={remoteUrl} onChangeText={setRemoteUrl} placeholder="git@github.com:you/notes.git" />
            <Field label="Branch" value={branch} onChangeText={setBranch} />
            <Field label="Username (for https)" value={username} onChangeText={setUsername} />
            <Field label="Password / token" value={password} onChangeText={setPassword} secureTextEntry />
            <Button title="Save & connect" onPress={() => void connectManually()} disabled={busy || !remoteUrl} />
            <InlineNote>
              git://, ssh:// and https:// remotes are supported. SSH remotes use the
              app key below automatically.
            </InlineNote>
          </>
        ) : null}
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
          <>
            <Button
              title="Generate key"
              kind="secondary"
              onPress={() => void core.generateSshKey().then(setSshKey).catch((error) => {
                useSyncStore.setState({ error: getErrorMessage(error) });
              })}
            />
            <InlineNote>
              Only needed for ssh:// remotes (e.g. GitHub). The local-network QR
              flow above doesn't need a key.
            </InlineNote>
          </>
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

      <Modal
        visible={scannerOpen}
        animationType="slide"
        onRequestClose={() => setScannerOpen(false)}
      >
        <View style={styles.scanner}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => onScanned(data)}
          />
          <View style={[styles.scannerOverlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.scannerHint}>
              Point at the QR code in desktop Settings → Sync
            </Text>
            <View style={styles.scannerFooter}>
              {scanNotice ? (
                <Text style={styles.scannerNotice}>{scanNotice}</Text>
              ) : null}
              <Button title="Cancel" kind="secondary" onPress={() => setScannerOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
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
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16 },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNumber: { fontSize: 14, fontWeight: "700", width: 16, textAlign: "center" },
  stepText: { fontSize: 14, lineHeight: 20, flex: 1 },
  statusGrid: { gap: 6 },
  statusLine: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  statusLabel: { fontSize: 13 },
  statusValue: { fontSize: 13, fontWeight: "500", flexShrink: 1 },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonGrow: { flex: 1 },
  sshKey: { fontSize: 12, fontFamily: "Courier" },
  commit: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  commitMeta: { fontSize: 12 },
  scanner: { flex: 1, backgroundColor: "#000000" },
  scannerOverlay: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  scannerHint: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 4,
  },
  scannerFooter: { gap: 12 },
  scannerNotice: {
    color: "#ffffff",
    fontSize: 13,
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    padding: 10,
  },
});
