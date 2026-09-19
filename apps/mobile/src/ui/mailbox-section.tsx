import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useSyncStore } from "../state/sync-store";
import { activeProfile, useSettingsStore } from "../state/settings-store";
import { useTheme } from "../theme";
import { Button, Field, InlineNote, Section } from "./controls";

export function MailboxSection({ scan }: { scan: () => void }) {
  const sync = useSyncStore();
  const profileId = activeProfile(useSettingsStore(state => state.snapshot))?.id;
  const theme = useTheme();
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState<string | null>(null);
  useEffect(() => { setCode(""); setPairing(null); }, [profileId]);
  const busy = sync.action !== "idle";
  return <Section title="Encrypted sync peer">
    <InlineNote>Sync while your computer is offline. Notes stay readable here; your server stores only encrypted data.</InlineNote>
    {sync.mailboxStatus?.enabled ? <>
      <InlineNote>{sync.mailboxStatus.last_sync_ms ? `Uploaded to peer: ${new Date(sync.mailboxStatus.last_sync_ms).toLocaleString()}` : "First upload pending"}. Your computer receives it when it next syncs.</InlineNote>
      <Button title={busy ? "Working…" : "Sync now"} disabled={busy} onPress={() => void sync.syncNow().catch(() => {})} />
      <Button title="Show device pairing code" kind="secondary" disabled={busy} onPress={() => {
        void sync.mailboxAction({ action: "pairing" }).then(result => setPairing(result.pairing_secret ?? null)).catch(() => {});
      }} />
      {pairing ? <>
        <Text selectable style={{ color: theme.colors.text }}>{pairing}</Text>
        <InlineNote>This secret grants access to your notes. Keep a private recovery copy before disconnecting your last device.</InlineNote>
        <Button title="Hide code" kind="secondary" onPress={() => setPairing(null)} />
      </> : null}
      <Button title="Disconnect peer" kind="secondary" disabled={busy} onPress={() => {
        void sync.mailboxAction({ action: "disconnect" }).then(() => setPairing(null)).catch(() => {});
      }} />
    </> : <>
      <Field label="Server setup or device pairing code" secureTextEntry value={code} onChangeText={setCode} />
      <Button title="Connect peer" disabled={busy || !code.trim()} onPress={() => {
        void sync.mailboxAction({ action: "configure", secret_code: code }).then(() => setCode("")).catch(() => {});
      }} />
      <Button title="Scan pairing QR" kind="secondary" disabled={busy} onPress={scan} />
      <InlineNote>For the second device, use the pairing code from your connected app, which includes the encryption key.</InlineNote>
    </>}
    {sync.error ? <InlineNote>{sync.error}</InlineNote> : null}
  </Section>;
}
