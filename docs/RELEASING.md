# Release status

The GPUI desktop currently builds unsigned macOS `.app` bundles:

```sh
npm run desktop:bundle       # dev bundle
npm run desktop:release      # release bundle; local only
```

Output: `<cargo target>/bundle/Type GPUI Dev.app` or `Type.app`.
The version comes from `apps/gpui/Cargo.toml`. Debug data is isolated;
release data uses `com.digital.type2`.

Signing, notarization, installer packaging and native auto-updates are not
implemented. The existing `.github/workflows/release.yml` still publishes the
previous Tauri shell for `desktop-v*` tags. It is not the native GPUI release
path. Do not publish GPUI artifacts to the old updater manifest. No native
release has been published as part of the migration.

Mobile distribution is unchanged; see
[MOBILE_AD_HOC_GITHUB_ACTIONS.md](MOBILE_AD_HOC_GITHUB_ACTIONS.md).

Exact migration checks and remaining work:
[GPUI_MIGRATION_STATUS.md](GPUI_MIGRATION_STATUS.md).
