# Build and test on macOS

Install Rust through rustup; `rust-toolchain.toml` pins the project toolchain.
The native launcher needs Python 3.11+. Node/npm are needed for mobile/MCP,
not for the GPUI app itself.

From the repository root:

```sh
npm run desktop:app
npm run desktop:build
npm run desktop:test
npm run desktop:bundle
```

Dev notes use `com.digital.type2.gpui.dev`. To use a synthetic fixture:

```sh
npm run desktop:app -- --data-dir /absolute/path/to/fixture
```

For direct Rust checks:

```sh
cargo fmt -p type-gpui --check
cargo check -p type-gpui
cargo test -p type-gpui -- --test-threads=1
cargo test -p type-core --lib
```

`CARGO_TARGET_DIR` can reuse an existing build cache; the migration-specific
path is in [the handoff](GPUI_MIGRATION_STATUS.md). `desktop.py` places `.app`
bundles under that target's `bundle/` directory and supports `--no-build`.
Tests use temporary roots. The user handles UI/feel review.

Mobile: `npm install`, then `npm run mobile:start` for the mock or
`npm run mobile:ios` for native codegen/build. See
[mobile README](../apps/mobile/README.md) and
[FFI bridge](../packages/mobile-core/README.md).
