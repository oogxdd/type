# Updater signing key — generating & rotating

The desktop updater refuses any payload that isn't signed by the private key
matching `plugins.updater.pubkey` in `apps/desktop/src-tauri/tauri.conf.json`.
This is **not** Apple code-signing — the two are independent.

- Private key: `~/.tauri/type-updater.key` (+ its password). Never committed.
- Public key: `~/.tauri/type-updater.key.pub` — pasted into `tauri.conf.json`, safe to commit.
- CI uses the same private key via the `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets.

> **Losing the password is the same as losing the key.** There is no recovery —
> `tauri signer sign` just reports `Wrong password for that key`. Store it in a
> password manager the moment you create it.

---

## What rotating costs

Rotating breaks auto-update **only for installs whose built-in pubkey is the old
one**. Those users are stranded on their current version and need one manual
`.dmg` install to get back on the update path — they don't lose data, the app
keeps working, it just stops finding updates.

So the cost scales with how many people run a build carrying the old key:

| Situation | Cost of rotating |
| --- | --- |
| No shipped build ever carried a real pubkey | **Zero.** Rotate freely. |
| Only you run the old builds | One manual `.dmg` install for yourself. |
| Other people are on old builds | They must each reinstall by hand. Avoid. |

Historical note: builds before 0.4.5 shipped the literal placeholder
`REPLACE_WITH_UPDATER_PUBLIC_KEY`, so they could never verify anything. The
original key's password was lost, and rotating at that point cost nothing —
which is exactly why it was done then rather than later.

---

## Rotating (or generating for the first time)

Run these in your own terminal — step 2 prompts for a password, and you don't
want it landing in an agent transcript or shell history.

### 1. Deal with the old key

**If you still have the old key's password, archive it** — it is the only thing
that can strand users *back* onto a working update path. See "Migrating users
across a rotation" below.

```bash
mkdir -p ~/.tauri/archive
STAMP=$(date +%Y%m%d)
mv ~/.tauri/type-updater.key     ~/.tauri/archive/type-updater-$STAMP.key
mv ~/.tauri/type-updater.key.pub ~/.tauri/archive/type-updater-$STAMP.key.pub
```

**If the password is lost, delete both files.** A private key you can't sign
with is dead weight, and verifying an old signature never uses the private key
anyway — the public key does that, and the key id is embedded in the signature
itself. Two similarly-named keys in `~/.tauri/` is a live hazard: point a script
at the wrong one and you ship a release nobody can install.

```bash
rm ~/.tauri/type-updater.key ~/.tauri/type-updater.key.pub
```

### 2. Generate the new keypair

```bash
cd apps/desktop
npx tauri signer generate -w ~/.tauri/type-updater.key
```

It prompts for a password twice. **Put that password in your password manager
now**, labelled with the key's id (the `minisign public key: <ID>` line inside
the `.pub` file).

### 3. Put the public key into the app config

```bash
cd apps/desktop
PUBKEY="$(tr -d '\n' < ~/.tauri/type-updater.key.pub)" node -e '
const fs = require("fs");
const path = "src-tauri/tauri.conf.json";
const config = JSON.parse(fs.readFileSync(path, "utf8"));
config.plugins.updater.pubkey = process.env.PUBKEY;
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
'
```

Commit that change. It must land on `main` **before** you tag the release —
the app embeds whatever pubkey is in the config at build time.

### 4. Update the CI secrets

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo oogxdd/type < ~/.tauri/type-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo oogxdd/type
# ↑ prompts; paste the password from step 2
```

Verify both are listed:

```bash
gh secret list --repo oogxdd/type
```

The release workflow fails fast with `Missing TAURI_SIGNING_PRIVATE_KEY
repository secret.` if either is absent, so a missing secret costs you a failed
run rather than a broken release.

### 5. Sanity-check the key before burning a build

Signing takes a second; a full release build takes ten-plus minutes.

```bash
cd apps/desktop
echo test > /tmp/sigtest.txt
npx tauri signer sign -f ~/.tauri/type-updater.key /tmp/sigtest.txt
# prompts for the password — a signature block means the pair is good
```

### 6. Release

Tag as usual (see [RELEASING.md](./RELEASING.md)). Then install the resulting
`.dmg` by hand once — your currently-installed build still carries the old
pubkey and cannot update itself onto the new key.

---

## Migrating users across a rotation

If people are already running builds that carry the **old** pubkey, rotating
strands them — their app keeps checking, keeps verifying against the old key,
and rejects everything you sign with the new one.

You can carry them over **without a manual reinstall**, but only while the old
key is still usable:

1. Build the new version with the **new** pubkey in `tauri.conf.json`.
2. Sign that payload with the **old** private key.
3. Publish it. Old installs verify the signature against the old key, accept it,
   and the app they end up running embeds the new pubkey.
4. Every release after that is signed with the new key only.

This is the entire reason to archive an old key rather than delete it — and it
requires the old password. Once that password is gone, so is this path, and
stranded users have no option but a manual `.dmg`.

---

## Checking which key a build expects

The pubkey is embedded in the binary:

```bash
node -e 'console.log(require("./apps/desktop/src-tauri/tauri.conf.json").plugins.updater.pubkey)' \
  | base64 -d
```

That prints the `minisign public key: <ID>` comment. The `signature` field in a
release's `latest.json` decodes to a line carrying the same key id — if the ids
differ, that release cannot be installed by that build.

```bash
curl -sL https://github.com/oogxdd/type/releases/latest/download/latest.json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Buffer.from(JSON.parse(s).platforms["darwin-aarch64"].signature,"base64").toString()))'
```
