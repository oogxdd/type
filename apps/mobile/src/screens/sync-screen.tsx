// Primary encrypted filesystem sync plus optional legacy Git setup.

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
  formatTransferProgress,
  transferProgressFraction,
} from "@typenotes/shared/format";
import { parseSyncDeepLink, type SyncDeepLinkParams } from "@typenotes/shared/sync-link";

import { useClearInstantParam } from "../navigation";
import { autoSyncLabel } from "../lib/sync-experience";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useSyncStore } from "../state/sync-store";
import { useTheme } from "../theme";
import { Button, Field, InlineNote, Section } from "../ui/controls";

const SETUP_STEPS = [
  "Open the Type app on your computer.",
  "Open desktop Settings → Sync (phone and computer on the same Wi-Fi or hotspot).",
  "Tap “Scan QR code” below and point the camera at the code on the computer's screen.",
  "After pairing, just open Type on your phone near the computer — sync starts automatically.",
];

export const SyncScreen = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Capture may have pushed this screen without a native animation because
  // its live preview already played the transition. Restore normal pop/back
  // behavior once this real screen is attached.
  useClearInstantParam();
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
    console.log("[sync:qr] applying parsed sync link");
    setRemoteUrl(link.remote ?? "");
    setBranch(link.branch ?? "main");
    try {
      await sync.connectFromLink(link);
      console.log("[sync:qr] sync link applied successfully");
      setConnectedVia(link.name ?? link.remote ?? "computer");
    } catch (error) {
      console.log(`[sync:qr] failed to apply sync link: ${getErrorMessage(error)}`);
      // surfaced via store error state
    } finally {
      void core.getSshPublicKey().then(setSshKey).catch(() => {});
    }
  };

  // A type2://sync deep link (system camera) lands here via the sync store.
  const pendingLink = useSyncStore((s) => s.pendingLink);
  useEffect(() => {
    if (pendingLink) {
      console.log("[sync:qr] pending deep link received");
      sync.setPendingLink(null);
      void applyLink(pendingLink);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLink]);

  const openScanner = async () => {
    setScanNotice(null);
    if (!permission?.granted) {
      console.log("[sync:qr] requesting camera permission");
      const result = await requestPermission();
      if (!result.granted) {
        console.log("[sync:qr] camera permission denied");
        useSyncStore.setState({
          error: "Camera permission is needed to scan the QR code. Enable it in system settings.",
        });
        return;
      }
    }
    handledScanRef.current = false;
    console.log("[sync:qr] scanner opened");
    setScannerOpen(true);
  };

  const onScanned = (data: string) => {
    if (handledScanRef.current) {
      return;
    }
    const link = parseSyncDeepLink(data);
    if (!link) {
      console.log("[sync:qr] scanned QR was not a Type sync link");
      setScanNotice("That QR code is not a Type sync code — look for the one in desktop Settings → Sync.");
      return;
    }
    console.log("[sync:qr] valid Type sync QR scanned");
    handledScanRef.current = true;
    setScannerOpen(false);
    void applyLink(link);
  };

  const busy = sync.action !== "idle";
  const primarySyncTitle =
    sync.action === "connect"
      ? "Connecting..."
      : sync.action === "pull"
        ? "Pulling..."
        : sync.action === "push"
          ? "Pushing..."
          : busy
            ? "Syncing..."
            : "Sync now";
  const status = sync.status;
  const docsStatus = sync.docsStatus;
  const transferLabel = formatTransferProgress(sync.progress);
  const transferFraction = transferProgressFraction(sync.progress);
  const automaticStatus = autoSyncLabel(sync.autoSyncState);
  // A saved remote counts as connected even when the repo's origin is missing
  // (e.g. an earlier connect attempt failed halfway): pull/push re-apply the
  // saved connection via ensureSavedRemote, so the buttons must stay usable —
  // otherwise a half-connected state locks the user out of the recovery path.
  const savedRemote = profile?.settings.git_remote_url.trim();
  const docsConnected = Boolean(docsStatus?.configured);
  const connected =
    docsConnected || Boolean(status?.repo_initialized && (status?.remote_url || savedRemote));

  const connectManually = async () => {
    try {
      await settingsStore.saveGitSettings({
        remoteUrl,
        branch,
        username,
        password,
        commitMessage: profile?.settings.git_commit_message ?? "Sync notes",
        trustedSshHost: null,
        trustedSshHostKeySha256: null,
        irohTicket: null,
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
        {docsConnected && docsStatus ? (
          <View style={styles.statusGrid}>
            {automaticStatus ? (
              <StatusLine label="Automatic sync" value={automaticStatus} />
            ) : null}
            <StatusLine
              label="State"
              value={
                docsStatus.phase === "waiting_for_peer"
                  ? "waiting for computer"
                  : docsStatus.phase.replaceAll("_", " ")
              }
            />
            <StatusLine label="Nearby peers" value={String(docsStatus.neighbors)} />
            {sync.docsResult ? (
              <StatusLine
                label="Last transfer"
                value={`${sync.docsResult.published} sent · ${sync.docsResult.applied} applied`}
              />
            ) : null}
          </View>
        ) : status ? (
          <View style={styles.statusGrid}>
            {automaticStatus ? (
              <StatusLine label="Automatic sync" value={automaticStatus} />
            ) : null}
            <StatusLine label="Connection" value={connected ? "connected" : "not paired"} />
            <StatusLine label="Remote" value={status.remote_url ?? (savedRemote || "—")} />
            <StatusLine label="Branch" value={status.current_branch ?? "—"} />
            <StatusLine
              label="Changes"
              value={status.has_uncommitted_changes ? "pending — will sync next" : "none"}
            />
            <StatusLine label="Ahead / behind" value={`${status.ahead} / ${status.behind}`} />
          </View>
        ) : (
          <InlineNote>Pull to refresh status.</InlineNote>
        )}
        {!docsConnected && status && !status.remote_url && savedRemote ? (
          <InlineNote>
            The saved connection will be re-applied on the next sync.
          </InlineNote>
        ) : null}
        <Button
          title={primarySyncTitle}
          onPress={() => void sync.syncNow().catch(() => {})}
          disabled={busy || !connected}
        />
        {busy && transferLabel ? (
          <View style={styles.progressBlock}>
            <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: theme.colors.accent,
                    width: `${Math.round((transferFraction ?? 1) * 100)}%`,
                    opacity: transferFraction === null ? 0.35 : 1,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressLabel, { color: theme.colors.secondaryText }]}>
              {transferLabel}
            </Text>
          </View>
        ) : null}
        {!docsConnected ? (
          <View style={styles.buttonRow}>
            <View style={styles.buttonGrow}>
              <Button title="Pull only" kind="secondary" onPress={() => void sync.pull().catch(() => {})} disabled={busy || !connected} />
            </View>
            <View style={styles.buttonGrow}>
              <Button title="Push only" kind="secondary" onPress={() => void sync.push().catch(() => {})} disabled={busy || !connected} />
            </View>
          </View>
        ) : null}
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
              app key below automatically. QR local sync also pins the desktop host key.
            </InlineNote>
          </>
        ) : null}
      </Section>

      {!docsConnected ? <Section title="SSH key">
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
              The QR local-sync flow creates this automatically when needed.
              Generate it manually for other ssh:// remotes such as GitHub.
            </InlineNote>
          </>
        )}
      </Section> : null}

      {!docsConnected ? <Section title="Git history (optional)">
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
      </Section> : null}

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
  progressBlock: { gap: 4 },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  progressLabel: { fontSize: 12 },
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
