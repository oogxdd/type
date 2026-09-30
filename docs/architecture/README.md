# Type architecture

Desktop: `apps/gpui` (Rust + GPUI Kit). Mobile: `apps/mobile` (React Native).
Both use `crates/type-core`; mobile crosses `crates/type-ffi` through UniFFI.
The desktop calls application services directly.

```text
GPUI shell / UniFFI exports
             ↓
        application → ports ← adapters
             ↓
           domain
```

Core receives `AppEnv { app_data_dir, documents_dir }`, never a window or UI
handle. Domain owns DTOs, application owns workflows, ports define contracts,
and adapters own filesystem/Git/crypto/transcription implementations. A shell
owns focus, UI state, platform recording and background orchestration.

New core behavior belongs in application/ports/adapters. Call it from GPUI;
export it through UniFFI only when mobile needs it, then regenerate bindings and
align the typed bridge. Keep storage formats and tag rules shared.

[Code conventions](../../AGENTS.md) · [Native shell](../../apps/gpui/README.md)
· [Mobile bridge](../../packages/mobile-core/README.md)
· [Migration status](../GPUI_MIGRATION_STATUS.md)

The retained sync research is separate from implemented architecture:
[untrusted peer](10-zero-knowledge-sync-peer.md) and
[filesystem sync](11-filesystem-sync-without-git.md).
