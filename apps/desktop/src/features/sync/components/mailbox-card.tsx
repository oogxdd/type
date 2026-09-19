import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useProfiles } from "@/features/profiles/hooks/profiles-context";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { SettingsActionRow, SettingsCard, SettingsErrorText, SettingsHelpText } from "@/features/settings/components/settings-ui";
import { useMailbox } from "../hooks/mailbox-context";

export function MailboxCard() {
  const { status, busy, error, execute } = useMailbox();
  const { activeProfileId, activeProfileNotesRoot } = useProfiles();
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState<string | null>(null);
  useEffect(() => { setCode(""); setPairing(null); }, [activeProfileId, activeProfileNotesRoot]);
  return <SettingsCard title="Encrypted sync peer" description="Sync through your always-online server, even when your other device is offline. Notes stay readable locally; the server stores encrypted data only.">
    {status?.enabled ? <>
      <SettingsHelpText>{status.last_sync_ms ? `Uploaded to peer: ${new Date(status.last_sync_ms).toLocaleString()}` : "Connected. First upload pending."} This does not mean the other device has received it yet.</SettingsHelpText>
      <SettingsActionRow>
        <Button size="sm" disabled={busy} onClick={() => void execute({ action: "sync" })}>{busy ? "Working…" : "Sync now"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const result = await execute({ action: "pairing" }); setPairing(result?.pairing_secret ?? null); }}>Pair another device</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => { await execute({ action: "disconnect" }); setPairing(null); }}>Disconnect</Button>
      </SettingsActionRow>
      {pairing ? <div className="grid gap-3">
        <div className="w-fit rounded bg-white p-3"><QRCodeSVG value={pairing} size={240} /></div>
        <SettingsHelpText>This code grants access to your notes and the decryption key. Keep a private recovery copy before disconnecting your last device.</SettingsHelpText>
        <Input aria-label="Device pairing code" readOnly value={pairing} onFocus={event => event.target.select()} />
        <Button size="sm" variant="outline" onClick={() => setPairing(null)}>Hide code</Button>
      </div> : null}
    </> : <>
      <Input aria-label="Sync peer setup code" type="password" autoComplete="off" placeholder="Paste server setup or device pairing code" value={code} onChange={event => setCode(event.target.value)} />
      <SettingsActionRow><Button size="sm" disabled={busy || !code.trim()} onClick={async () => { if (await execute({ action: "configure", secret_code: code })) setCode(""); }}>{busy ? "Connecting…" : "Connect peer"}</Button></SettingsActionRow>
      <SettingsHelpText>On your first device, paste the setup code from your VPS. On the next device, use “Pair another device” from the connected app.</SettingsHelpText>
    </>}
    {error ? <SettingsErrorText>{error}</SettingsErrorText> : null}
  </SettingsCard>;
}
