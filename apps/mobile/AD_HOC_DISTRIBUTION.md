# Ad-hoc: building and installing the iOS app without TestFlight

Ad-hoc is the normal mobile release route. Push a `mobile-v*` tag and
`.github/workflows/mobile-adhoc.yml` builds a signed `.ipa`, verifies that the
configured devices are in its provisioning profile, stores it as a workflow
artifact and GitHub Release asset, and deploys the install page to
`https://type-ota.vercel.app`.

The local build instructions below remain as a fallback and as a way to debug
signing. CI and local builds use the same native-code generation, Xcode archive,
`ExportOptionsAdHoc.plist`, and OTA generator.

> **Read this before installing.** An ad-hoc build carries a different signature
> than the TestFlight copy of the same bundle id, so iOS refuses to install one
> over the other. The existing app must be deleted first, and **that erases its
> container — notes, sync settings, and the device's SSH key.** Sync from the
> phone first. If the same version is already on TestFlight, install it from
> there instead: that path updates in place and keeps the data.

---

## GitHub Actions release (normal route)

The one-time setup, secrets, and release flow are documented in
[`docs/MOBILE_AD_HOC_GITHUB_ACTIONS.md`](../../docs/MOBILE_AD_HOC_GITHUB_ACTIONS.md).
For a release from `main`:

```sh
git tag mobile-v0.2.7
git push origin mobile-v0.2.7
```

When the **Mobile Ad Hoc** workflow succeeds, open
`https://type-ota.vercel.app` in Safari on a registered device. A manual run is
also available under Actions and accepts an explicit version/build number.

## Local-build prerequisites

- Apple Developer Program membership, team `Y377P5XKGJ`.
- App Store Connect API key at
  `~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8`
  (issuer `bd0c62da-fcbf-4770-a10d-2ee30da0963e`). Same key CI uses.
  **No local Apple Distribution certificate or `.p12` is needed** — `security
  find-identity -v -p codesigning` on this Mac normally shows only an "Apple
  Development" identity, never "Apple Distribution". That is fine: §1.5's
  archive step only needs *some* valid identity (Development is enough), and
  §1.6's `-exportArchive -allowProvisioningUpdates` is what actually gets the
  Distribution certificate — the API key lets Xcode fetch/provision it from
  App Store Connect during export, without ever touching the local keychain.
  Don't go hunting for a `.p12` or let Xcode create a certificate by hand
  first; just run the documented archive + export commands and let export
  handle it. (Verified 2026-09-04: archived with "Apple Development", the
  exported `.ipa` came back signed "Apple Distribution: Maxim Ignatev
  (Y377P5XKGJ)", and `security find-identity` was unchanged before and after —
  no certificate was created or consumed locally.)
- **The target device's UDID registered in the developer account.** Ad-hoc
  provisioning profiles embed a device list; export fails while building the
  profile if the device is not on it. Get the UDID from Xcode → Window → Devices
  and Simulators (the "Identifier" field), or `xcrun devicectl list devices`,
  and register it at developer.apple.com → Devices.
- Xcode with the iOS SDK, CocoaPods, and a Rust toolchain with the
  `aarch64-apple-ios` target.
- For the Vercel path: `vercel` CLI, logged in (`vercel whoami`).

Run everything from the repo root unless a step says otherwise.

---

## 1. Build the .ipa

### 1.1 Checks

```sh
npm run typecheck -w @typenotes/mobile
npm run test -w @typenotes/mobile
```

### 1.2 Set the version

`apps/mobile/app.config.js` reads `MOBILE_VERSION` and `IOS_BUILD_NUMBER` from
the environment and overrides whatever `app.json` says — that is how CI gets the
version from the tag without a commit. `expo prebuild` bakes those values into
`apps/mobile/ios/Type/Info.plist` as **literals**, not as `$(MARKETING_VERSION)`
references.

That last detail is the trap: passing `MARKETING_VERSION=` /
`CURRENT_PROJECT_VERSION=` on the `xcodebuild` command line does nothing,
because `Info.plist` no longer refers to those build settings. An archive built
that way silently carries the old version.

So either re-run prebuild with the environment set:

```sh
cd apps/mobile
MOBILE_VERSION=0.2.6 IOS_BUILD_NUMBER=2026090101 npx expo prebuild --platform ios
```

…or edit the two files by hand and keep them in sync:

- `apps/mobile/app.json` — `expo.version`, `expo.ios.buildNumber`
- `apps/mobile/ios/Type/Info.plist` — `CFBundleShortVersionString`,
  `CFBundleVersion`

`apps/mobile/ios/` is tracked, so inspect the diff after a prebuild. Only use
`--clean` after changing Expo config, plugins, or native dependencies.

### 1.3 Regenerate the Rust core with a device slice

The checked-in `packages/mobile-core/src/index.tsx` is a mock fallback so clean
clones and Expo Go work. A device build needs the real UniFFI turbo module:

```sh
IPHONEOS_DEPLOYMENT_TARGET=16.4 npm run codegen:ios:device -w @typenotes/mobile-core
```

`codegen:ios` (no `:device`) builds a **simulator-only** slice — it will archive
and then fail to link or run on hardware. Verify the package did not stay in
demo mode:

```sh
test -f packages/mobile-core/TypeCore.podspec
test -f packages/mobile-core/TypenotesMobileCoreFramework.xcframework/ios-arm64/libtype_ffi.a
grep -q 'Generated by uniffi-bindgen-react-native' packages/mobile-core/src/index.tsx
! grep -q '__isDemoCore' packages/mobile-core/src/index.tsx
```

Codegen overwrites `src/index.tsx`, so `git status` will show it modified
afterwards. That is expected — **do not commit it**; restore the fallback with
`git checkout -- packages/mobile-core/src/index.tsx` when done. The file cannot
be gitignored: `package.json` declares it as the package `main`, so a clean
clone without it has no entry point at all.

### 1.4 Pods

```sh
cd apps/mobile/ios
pod install
```

Run it from that directory. `pod install --project-directory=apps/mobile/ios`
from the repo root fails — the `Podfile` resolves React Native's location from
`Dir.pwd`, so it looks for `apps/mobile/node_modules/react-native` and does not
find the hoisted copy.

Confirm `Pods/Target Support Files/Pods-Type/Pods-Type.release.xcconfig`
contains `-lz -liconv`; the `Podfile` post-install hook adds them, and they are
required because `libtype_ffi.a` statically includes libgit2.

### 1.5 Archive

From `apps/mobile/ios`:

```sh
xcodebuild -workspace Type.xcworkspace -scheme Type -configuration Release \
  -destination "generic/platform=iOS" -archivePath build/Type.xcarchive archive \
  DEVELOPMENT_TEAM=Y377P5XKGJ CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
  -authenticationKeyID W2Y52J5N33 \
  -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
```

Check the version before spending an export on it:

```sh
/usr/libexec/PlistBuddy \
  -c "Print :ApplicationProperties:CFBundleShortVersionString" \
  -c "Print :ApplicationProperties:CFBundleVersion" \
  build/Type.xcarchive/Info.plist
```

### 1.6 Export ad-hoc

`ExportOptionsAdHoc.plist` is the ad-hoc counterpart to `ExportOptions.plist`
(App Store). `release-testing` is Xcode 15+'s name for the method previously
called `ad-hoc`.

```sh
xcodebuild -exportArchive -archivePath build/Type.xcarchive \
  -exportOptionsPlist ../ExportOptionsAdHoc.plist \
  -exportPath build/export-adhoc \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
  -authenticationKeyID W2Y52J5N33 \
  -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
```

### 1.7 Verify the .ipa

Confirm both the version and that the target device made it into the embedded
profile — a profile missing the device produces an "unable to install" that
looks identical to a signing failure:

```sh
cd $(mktemp -d) && unzip -q /path/to/build/export-adhoc/Type.ipa

/usr/libexec/PlistBuddy \
  -c "Print :CFBundleShortVersionString" \
  -c "Print :CFBundleVersion" \
  -c "Print :CFBundleIdentifier" \
  Payload/Type.app/Info.plist

security cms -D -i Payload/Type.app/embedded.mobileprovision > prof.plist
/usr/libexec/PlistBuddy -c "Print :Name" -c "Print :ProvisionedDevices" prof.plist
```

Expect `iOS Team Ad Hoc Provisioning Profile: com.typenotes.mobile` and the
device's UDID in the list.

---

## 2. Distribute over the air

iOS installs a signed build from a plain web page: Safari opens an
`itms-services://` URL, that fetches a manifest, and the manifest points at the
`.ipa`. Both files must come over **HTTPS with a publicly trusted certificate**
— true since iOS 7.1; a self-signed certificate is rejected unless its CA is
installed and explicitly trusted on the device.

This changes delivery only. The build is still ad-hoc signed, so only devices in
the profile can install it.

### 2.1 Generate the site

`scripts/ota.mjs` reads the bundle id, version, and build number out of the
`.ipa` itself rather than from `app.json`, because iOS matches the manifest
against the payload and a `bundle-version` that disagrees makes the install
silently do nothing.

```sh
npm run ota -w @typenotes/mobile -- build \
  ios/build/export-adhoc/Type.ipa \
  --base-url https://type-ota.vercel.app
```

Writes `apps/mobile/ios/build/ota/` (override with `--out`):

| file | |
|---|---|
| `index.html` | landing page with the Install button |
| `manifest.plist` | what `itms-services` fetches |
| `Type.ipa` | the payload |
| `vercel.json` | content types — hosts otherwise guess wrong for `.plist` |

### 2.2 Deploy to Vercel

The manifest needs **absolute** URLs, so the host URL has to be known before
generating. First time round it is not, so deploy twice:

```sh
cd apps/mobile/ios/build/ota
vercel deploy --prod --yes                       # 1. learn the URL
vercel inspect <deployment-url> | grep -A3 Aliases
```

Take the stable alias — for this project, `https://type-ota.vercel.app` — then
regenerate with it and redeploy:

```sh
npm run ota -w @typenotes/mobile -- build \
  ios/build/export-adhoc/Type.ipa --base-url https://type-ota.vercel.app
cd apps/mobile/ios/build/ota && vercel deploy --prod --yes
```

Vercel content-addresses uploads, so the second push of the same 30 MB payload
is near-instant. **Later releases are a single pass** — the alias is stable, so
generate with `--base-url https://type-ota.vercel.app` and deploy once.

The Vercel project name comes from the directory name (`ota` → adjust with
`vercel link` if you want something else). The existing project is `type-ota`
under `maxim-ignatevs-projects-ef3992aa`.

### 2.3 Verify before touching the phone

```sh
curl -sS -o /dev/null -w "index: %{http_code} %{content_type}\n"    https://type-ota.vercel.app/
curl -sS -o /dev/null -w "manifest: %{http_code} %{content_type}\n" https://type-ota.vercel.app/manifest.plist
curl -sSI https://type-ota.vercel.app/Type.ipa | grep -iE "^HTTP|content-type|content-length"
```

Expect `text/html`, `text/xml`, and `application/octet-stream`. A `401` means
Vercel Deployment Protection is on for the project — turn it off in the
project's settings, or the phone gets a login wall instead of the app.

Also confirm the manifest picked up the right URL and version:

```sh
curl -sS https://type-ota.vercel.app/manifest.plist | grep '<string>'
```

### 2.4 Install

Open `https://type-ota.vercel.app` **in Safari on the device** and tap Install.
Other browsers ignore the `itms-services` scheme and the button does nothing.
The icon appears on the home screen with a progress ring; the first launch may
need Settings → General → VPN & Device Management to trust the developer.

The URL is public — anyone can download the binary, though only registered
devices can install it. Delete the Vercel project when done if that matters.

---

## 3. Alternative: local server behind a tunnel

For a one-off install with nothing left hosted anywhere:

```sh
npm run ota -w @typenotes/mobile -- serve ios/build/export-adhoc/Type.ipa
# in another shell:
cloudflared tunnel --url http://localhost:8787     # or: ngrok http 8787
```

Open the tunnel's HTTPS URL in Safari. The server generates the manifest per
request from the `Host` / `X-Forwarded-Proto` headers, so the public URL does
not have to be known in advance and nothing needs regenerating when the tunnel
comes up with a fresh address. Neither tunnel client is installed by default
(`brew install cloudflared`).

## 4. Alternative: cable

Xcode → Window → Devices and Simulators → select the device → drag the `.ipa`
into "Installed Apps", or use Apple Configurator. No HTTPS, no hosting; the
device has to be connected and unlocked. Note that AirDropping an `.ipa` or
opening it from Files does **not** work — iOS will not install it that way.

---

## Troubleshooting

| symptom | cause |
|---|---|
| Export fails building the provisioning profile | device UDID not registered in the account |
| Install button does nothing | page opened in a browser other than Safari |
| "Unable to install" | device not in the embedded profile (§1.7), or a differently-signed copy of the same bundle id is already installed |
| Install starts, then the icon greys out permanently | manifest `bundle-identifier` / `bundle-version` disagree with the payload |
| Safari shows the manifest as text | host served `.plist` with the wrong content type — `vercel.json` fixes this on Vercel |
| Phone gets a Vercel login page | Deployment Protection enabled on the project |
| App launches into demo mode with a banner | `codegen:ios:device` was skipped, or `src/index.tsx` was reverted before archiving (§1.3) |
| Crash on launch on device only | simulator-only core slice — `codegen:ios` instead of `codegen:ios:device` |
