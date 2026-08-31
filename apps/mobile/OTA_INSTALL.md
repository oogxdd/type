# Installing an ad-hoc build over the air

TestFlight is the normal route (`docs/RELEASING.md`, `LOCAL_TESTFLIGHT.md`).
This document covers the fallback: putting a Release build straight onto a
registered device from a web page, without a cable and without TestFlight.

## What iOS requires

Safari opens an `itms-services://` URL that points at a manifest; the manifest
points at the `.ipa`. Both files must be served over **HTTPS with a publicly
trusted certificate** — that has been true since iOS 7.1, and a self-signed
certificate is rejected unless its CA is installed and explicitly trusted on the
device (Settings → General → About → Certificate Trust Settings).

Delivery is the only thing this changes. The build is still ad-hoc signed, so
the device's UDID must already be in the provisioning profile; anyone else who
opens the link gets "unable to install".

> **It does not install over TestFlight.** An ad-hoc build carries a different
> signature than the TestFlight copy of the same bundle id, so iOS refuses to
> replace one with the other. The installed app has to be deleted first, and
> that erases its container — notes, sync settings, and the device's SSH key.
> Sync from the phone before doing this.

## Building the site

`scripts/ota.mjs` reads the bundle id, version, and build number out of the
`.ipa` itself rather than from `app.json`, because a `bundle-version` that does
not match the payload makes the install silently do nothing.

```sh
npm run ota -w @typenotes/mobile -- build \
  ios/build/export-adhoc/Type.ipa \
  --base-url https://<your-host>
```

That writes `ios/build/ota/` (override with `--out`):

| file | |
|---|---|
| `index.html` | landing page with the Install button |
| `manifest.plist` | what `itms-services` fetches |
| `Type.ipa` | the payload |
| `vercel.json` | content types — hosts otherwise guess wrong for `.plist` |

Upload that folder to any static host and open its URL in Safari **on the
device**. Other browsers ignore the `itms-services` scheme and the button does
nothing.

The URL is public: anyone can download the binary, though only registered
devices can install it.

## Local server behind a tunnel

For a one-off install with nothing left hosted anywhere:

```sh
npm run ota -w @typenotes/mobile -- serve ios/build/export-adhoc/Type.ipa
# then, in another shell:
cloudflared tunnel --url http://localhost:8787   # or: ngrok http 8787
```

Open the tunnel's HTTPS URL in Safari. The server generates the manifest per
request from the `Host` / `X-Forwarded-Proto` headers, so the public URL does
not have to be known in advance — no regenerating anything after the tunnel
comes up. Neither `cloudflared` nor `ngrok` is installed by default
(`brew install cloudflared`).

## Producing the .ipa

`ExportOptionsAdHoc.plist` is the ad-hoc counterpart to `ExportOptions.plist`
(App Store). `release-testing` is Xcode 15+'s name for the method previously
called `ad-hoc`. Archive as in `LOCAL_TESTFLIGHT.md`, then:

```sh
xcodebuild -exportArchive -archivePath build/Type.xcarchive \
  -exportOptionsPlist ../ExportOptionsAdHoc.plist \
  -exportPath build/export-adhoc \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_W2Y52J5N33.p8 \
  -authenticationKeyID W2Y52J5N33 \
  -authenticationKeyIssuerID bd0c62da-fcbf-4770-a10d-2ee30da0963e
```

Export fails while building the profile if the target device's UDID is not
registered in the developer account.
