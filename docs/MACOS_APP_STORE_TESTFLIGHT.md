# Mac App Store / TestFlight for macOS

This is the future macOS App Store path for Type. It is separate from the DMG
release flow.

## What is different

- DMG is direct distribution outside Apple.
- Mac App Store uses App Store Connect, a signed `.pkg`, and App Sandbox.
- Apple says a single App Store Connect record can cover multiple platforms,
  and the platforms share the same bundle ID when you add them to one app
  record.

For this repo, that means the macOS App Store build should use the same app
identity family as iOS if you want a single cross-platform product record in
App Store Connect.

## Official references

- [Add a new app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
- [Add platforms](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms)
- [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
- [Tauri App Store guide](https://v2.tauri.app/distribute/app-store/)
- [Tauri macOS app bundle](https://v2.tauri.app/distribute/macos-application-bundle/)
- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)

## One-time Apple setup

1. Join the Apple Developer Program.
2. Create or reuse the App Store Connect app record.
3. If you want iOS + macOS as one product, add the macOS platform to the same
   record. Apple says the platforms share the same bundle ID in that setup.
4. Make sure the bundle ID in Tauri matches the App Store Connect bundle ID.

## One-time repo setup

Create a separate App Store config overlay, for example:

```text
src-tauri/tauri.appstore.conf.json
```

That overlay should hold the App Store specific macOS settings, especially:

- App Sandbox entitlements
- any App Store-only bundle tweaks
- optional embedded provisioning profile, if your signing flow needs it

Tauri’s App Store guide says macOS App Store builds require App Sandbox. Apple
also says sandboxed apps must explicitly request access to the resources they
need.

## Likely sandbox work for this repo

This is the part that will take actual product work, not just release tooling.
I am inferring this from the app’s current behavior.

Type writes to user-chosen note roots, syncs with git remotes, can start a local
git daemon, records audio, and may need network access. A sandboxed Mac App
Store build will likely need careful entitlements and maybe code changes for:

- user-selected file access for notes roots
- network client access for Git and transcription APIs
- network server access for the local sync daemon
- microphone / audio input access

Apple’s sandbox docs say you cannot just grant full disk access by fiat; user
selection or a narrower entitlement path is required.

## Build flow

Tauri’s current App Store guidance is:

```bash
npm run tauri build -- --bundles app --config src-tauri/tauri.appstore.conf.json
```

That produces the `.app` bundle you then package into a signed `.pkg`.

Then:

```bash
xcrun productbuild --sign "<Mac Installer Distribution identity>" \
  --component "target/<target>/release/bundle/macos/Type.app" \
  /Applications Type.pkg

xcrun altool --upload-app --type macos --file Type.pkg \
  --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
```

Use a unique build string for each upload. Apple identifies a build by bundle
ID, version, and build string.

## TestFlight flow

1. Upload the `.pkg`.
2. Wait for Apple processing.
3. Open the app record in App Store Connect.
4. Use the TestFlight tab to choose the build and add testers.

## Repo notes

- The current DMG release path stays as-is.
- The App Store macOS path should be a separate config + packaging flow.
- Don’t reuse the DMG notarization guide as a substitute for App Store
  sandboxing. They solve different problems.
