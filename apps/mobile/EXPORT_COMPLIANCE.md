# Export compliance (encryption declaration)

Every iOS build upload triggers Apple's **export-compliance** question because
the app uses encryption. This is a US export-law (EAR) requirement, not an
Apple-specific one. We answer it **once, in config**, so TestFlight/App Store
Connect stops asking on every build.

## What we declare

`app.json` → `expo.ios.infoPlist`:

```json
"ITSAppUsesNonExemptEncryption": false
```

This bakes `ITSAppUsesNonExemptEncryption = false` into `Info.plist`. Result:
no export-compliance prompt on upload, and no follow-up France / documentation
questions.

## Why `false` is correct here

`false` declares the app's encryption is **exempt** from export restrictions.
That holds for this app because:

- It uses **standard, published algorithms** — XChaCha20-Poly1305 (at-rest note
  body encryption) and Argon2id (password KDF) — **not proprietary crypto**.
- Encryption only protects the **user's own local data** (note bodies at rest)
  and standard transport security (HTTPS / SSH for git sync).
- No custom/controlled cryptographic implementation is shipped.

This is the standard self-classification for a local-first notes app of this
kind. It is a declaration you (the account holder) make to Apple; it is
reversible.

## When this must change to `true`

Flip to `true` (and then complete the export-compliance documentation +
year-end self-classification / French declaration in App Store Connect) only if
the app later ships **non-exempt** encryption — e.g. a proprietary cipher, or
encryption offered as a primary controlled feature beyond protecting the user's
own data. Adding more *standard* algorithms for user-data protection does not by
itself require `true`.

## History

- Before this key existed, uploads prompted the questionnaire manually. Choosing
  "uses encryption / non-proprietary" led into the France / annual-report
  branch. Setting `ITSAppUsesNonExemptEncryption = false` removes that branch
  entirely.
- Added alongside build `2026070703` (v0.1.0), 2026-07-07.

See `TESTFLIGHT_HANDOFF.md` for the full release procedure.
