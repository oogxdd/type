# Device Development Without Overwriting TestFlight

The TestFlight build ships as **Type** (`com.typenotes.mobile`).  To run a
development build on the same iPhone without replacing it, use the **dev
variant** — a second app (**Type Dev**, `com.typenotes.mobile.dev`) that
installs side-by-side with its own data container.

## How it works

`apps/mobile/app.config.js` reads the `APP_VARIANT` environment variable:

| `APP_VARIANT` | App name | Bundle ID | Purpose |
|---|---|---|---|
| *(unset)* | Type | `com.typenotes.mobile` | TestFlight / production |
| `dev` | Type Dev | `com.typenotes.mobile.dev` | Local device development |

Both apps can be installed on the same device simultaneously. They do not
share data — each has its own documents directory, settings, and notes.

## First-time dev build on a physical iPhone

Run from the repo root. Prerequisites: `npm install`, iPhone connected via
USB/Wi-Fi, Apple Developer account on the machine.

```sh
# 1. Generate the Rust core with a device slice (simulator-only will NOT link)
IPHONEOS_DEPLOYMENT_TARGET=16.4 \
  npm run codegen:ios:device -w @typenotes/mobile-core

# 2. Prebuild the dev variant (regenerates apps/mobile/ios with .dev bundle ID)
npm run mobile:ios:dev:prebuild

# 3. Install pods
cd apps/mobile/ios && pod install && cd -

# 4. Build and install on the connected device
npm run mobile:ios:dev:device
```

After step 4 the **Type Dev** icon appears on the home screen (next to the
TestFlight **Type** icon) and Metro opens automatically for hot reload.

## Day-to-day development (JS/TS only)

No native rebuild needed — just start Metro and keep the already-installed
Type Dev app open:

```sh
npm run mobile:start
```

## When to re-prebuild the dev variant

Only after changing **native** dependencies — Expo config/plugins, Rust core,
new native modules. For pure JS/TS changes, Metro hot reload is enough.

```sh
# Rust core changed
IPHONEOS_DEPLOYMENT_TARGET=16.4 \
  npm run codegen:ios:device -w @typenotes/mobile-core
cd apps/mobile/ios && pod install && cd -
npm run mobile:ios:dev:device
```

If Expo config/plugins changed, also run `npm run mobile:ios:dev:prebuild`
before `pod install`.

## Switching back to a TestFlight build

When you need to cut a TestFlight upload, prebuild the production variant and
follow the normal release flow (see `LOCAL_TESTFLIGHT.md` / `TESTFLIGHT_HANDOFF.md`):

```sh
# Prebuild production (no APP_VARIANT) — restores com.typenotes.mobile
cd apps/mobile && npx expo prebuild --platform ios --clean && cd -
```

Then continue with the archive → export → upload steps in `LOCAL_TESTFLIGHT.md`.

> **Note:** prebuilding production overwrites `apps/mobile/ios/`, replacing the
> dev-variant bundle ID. To resume device development, re-run
> `npm run mobile:ios:dev:prebuild`.
