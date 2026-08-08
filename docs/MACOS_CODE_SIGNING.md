# macOS code signing & notarization (direct .dmg distribution)

Without this, the `.dmg` still installs and updates fine — macOS just shows
"cannot be opened because it is from an unidentified developer" on first open,
and you get in with right-click → Open. With it, the app opens normally.

This is **independent of the updater signing key** ([UPDATER_KEY_ROTATION.md](./UPDATER_KEY_ROTATION.md)).
The updater key proves *an update payload came from you*; Apple signing proves
*the app bundle came from a known developer* to Gatekeeper. You need both, and
neither substitutes for the other.

> This is the direct-download path (Developer ID). The Mac App Store path is
> different — see [MACOS_APP_STORE_TESTFLIGHT.md](./MACOS_APP_STORE_TESTFLIGHT.md).

---

## What you need

| Thing | Where it comes from |
| --- | --- |
| Apple Developer Program | $99/year — required to get a Developer ID certificate |
| **Developer ID Application** certificate | developer.apple.com → Certificates |
| The certificate exported as `.p12` | Keychain Access, with a password you choose |
| App-specific password | appleid.apple.com → Sign-In and Security |
| Team ID | developer.apple.com → Membership (10 characters) |

Pick **Developer ID Application**, not "Apple Distribution" or "Mac App Store" —
those are for App Store submission and Gatekeeper won't accept them for direct
downloads.

## Checking what you already have

```bash
security find-identity -v -p codesigning
```

A line like `"Developer ID Application: Your Name (TEAMID)"` means the
certificate and its private key are already in your Keychain — that whole
quoted string is your `APPLE_SIGNING_IDENTITY`, and the parenthesized part is
your `APPLE_TEAM_ID`.

---

## One-time setup

### 1. Create the certificate (skip if `find-identity` already lists it)

1. Keychain Access → Certificate Assistant → Request a Certificate From a
   Certificate Authority → save the CSR to disk.
2. developer.apple.com → Certificates → **+** → Developer ID Application →
   upload the CSR → download the `.cer` → double-click to install.

### 2. Export it as `.p12`

Keychain Access → My Certificates → right-click the *Developer ID Application*
row → Export. Choose Personal Information Exchange (`.p12`), set a password, and
**save that password** — it becomes `APPLE_CERTIFICATE_PASSWORD`.

Expand the row and confirm a private key is nested under the certificate before
exporting. Without the key the `.p12` is useless for signing.

### 3. Create an app-specific password

appleid.apple.com → Sign-In and Security → App-Specific Passwords → generate one
(label it e.g. "type notarization"). This is `APPLE_PASSWORD` — your real Apple
ID password will not work for notarization.

### 4. Set the repository secrets

> `gh secret set` will happily store an **empty** value. Piping into it from a
> command that failed — a missing `.p12`, a typo'd path — prints a cheerful
> `✓ Set Actions secret` while writing nothing. Guard the pipe, or you'll be
> debugging a signing failure whose cause is an empty secret that looks present
> in `gh secret list`.

```bash
set -o pipefail
P12=~/Desktop/type-developer-id.p12
[ -s "$P12" ] && base64 -i "$P12" | tr -d '\n' \
  | gh secret set APPLE_CERTIFICATE --repo oogxdd/type \
  || echo "STOP: $P12 missing or empty — secret left untouched"

# each of these prompts; nothing lands in shell history
read -rs "PW?p12 password: "; echo
printf '%s' "$PW" | gh secret set APPLE_CERTIFICATE_PASSWORD --repo oogxdd/type; unset PW

read -rs "PW?app-specific password: "; echo
printf '%s' "$PW" | gh secret set APPLE_PASSWORD --repo oogxdd/type; unset PW

printf '%s' 'Developer ID Application: Your Name (TEAMID)' \
  | gh secret set APPLE_SIGNING_IDENTITY --repo oogxdd/type
printf '%s' 'you@example.com' | gh secret set APPLE_ID --repo oogxdd/type
printf '%s' 'TEAMID'          | gh secret set APPLE_TEAM_ID --repo oogxdd/type
```

`gh secret set NAME VALUE` does **not** work — gh takes the value from stdin or
`--body`, and a positional value fails with `accepts at most 1 arg(s)`.

Verify:

```bash
gh secret list --repo oogxdd/type    # expect 8 entries: 2 updater + 6 Apple
```

Delete the `.p12` afterwards; it can be re-exported from Keychain any time.

---

## How the workflow reacts

`release.yml` detects whether `APPLE_CERTIFICATE` is set and picks one of two
build steps. This is not cosmetic: an unset secret interpolates to an **empty
string**, and the Tauri bundler treats a *defined* `APPLE_CERTIFICATE` as "sign
this", then dies on `security import` with an empty certificate:

```
security: SecKeychainItemImport: One or more parameters passed to a function were not valid.
failed codesign application: failed to import keychain certificate
```

That is what a half-configured setup looks like — a failed release rather than
an unsigned one. Set all six Apple secrets or none.

---

## The entitlements gotcha

Notarization requires the **hardened runtime**, which denies microphone access
unless the app requests the entitlement — `NSMicrophoneUsageDescription` in
`Info.plist` is not enough on its own. Audio recording would work in local
unsigned builds and silently fail in every released one.

`src-tauri/entitlements.plist` covers this with
`com.apple.security.device.audio-input`, wired in via `bundle.macOS.entitlements`.
Add an entitlement here whenever a release build loses a capability that works
locally.

Related, worth re-testing after the first signed release: local Whisper and OCR
run a **managed Python** provisioned at runtime under app data. Executing a
downloaded interpreter is not blocked by the hardened runtime, but it is exactly
the kind of thing Gatekeeper policy interacts with. Verify transcription end to
end on a signed build before assuming it survived.

---

## Verifying a signed build

```bash
codesign -dv --verbose=4 /Applications/Type.app 2>&1 | grep -E 'Authority|TeamIdentifier|flags'
# expect Authority=Developer ID Application: …, and flags including runtime

spctl -a -vvv -t install /Applications/Type.app
# expect: accepted / source=Notarized Developer ID

xcrun stapler validate /Applications/Type.app
# expect: The validate action worked!
```

`source=Developer ID` without "Notarized" means signing worked but notarization
didn't staple — the app will still warn on machines that can't reach Apple.

## Signing a local build

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="<app-specific password>"
export APPLE_TEAM_ID="TEAMID"
# no APPLE_CERTIFICATE needed locally — the identity is already in your Keychain

npm run desktop:release 1.2.3
```

The first notarization of a build can take several minutes at the upload step;
that is Apple's side, not a hung build.
