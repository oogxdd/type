# Archived work

Work that is **shelved rather than abandoned** does not live in a branch. It
lives in a tag under `archive/`, and the branch is deleted.

This is a filing decision, not a cleanup ritual: it keeps the branch list
answering one question — *what am I actually going to merge or ship?* — while
nothing is lost. Tags keep their commits reachable forever, so `git gc` never
collects them.

## Branch or tag?

The test is not "soon vs. later", it is **will this ref ever move again?**

| | Branch | Tag under `archive/` |
|---|---|---|
| Expected to gain commits | yes | no |
| Shows in the branches list | yes | no — tags live on their own page |
| Can open a PR from it | yes | no (restore it to a branch first) |
| `behind/ahead` visible in the UI | yes | no |

So: still building it → branch. Frozen snapshot you *might* revisit → tag.

Two practical consequences worth knowing before you shelve something:

- **A tag cannot be the head of a PR.** Restoring to a branch is one command,
  but it is a step.
- **GitHub's branches page sorts by when the ref was last pushed, not by commit
  date.** Verified: a branch whose tip commit was 16 days old showed up as
  "9 hours ago" — the time it was pushed. So renaming a branch lifts it to the
  top of the list and there is no way to avoid that. Archiving sidesteps the
  problem instead of fighting it.

## Naming

```
archive/<theme>/<name>        grouped by what the work was about
archive/<YYYY-MM>/<name>      grouped by when it was shelved
```

Use a theme when several attempts belong together (`archive/alternative-sync/*`
holds the sync transports that lost). When one branch fully contains another,
one tag preserves both — name the inner commit in the message so the earlier
state stays retrievable, as `archive/alternative-sync/iroh-without-git` does. Use the date otherwise. Either way the
`archive/` prefix is what matters — every listing below globs on it.

Drop noise from the old branch name: `worktree-`, a duplicated `archive/`, an
`agent/` or `codex/` prefix that only records which tool produced it.

A flat `archive/<name>` is fine too when the work belongs to no group.

Release tags are `desktop-v*` and `mobile-v*`, and the release workflows trigger
on exactly those two patterns — so an `archive/*` tag never starts a build.

## Every archive tag is annotated

Archive tags are created with `-a -m` so each one **carries its own description**
— what the work was and why it was shelved. That message is the point: a bare
SHA six months from now tells you nothing. Keep it to a few sentences, and say
explicitly if part of the work already reached `main` by another route.

## Listing them

The GitHub web UI has no tag search, so use the CLI.

```bash
# everything archived, with its description, newest work first
git tag -l -n 'archive/*' --sort='-*committerdate'

# just names and the date of the work itself
git tag -l 'archive/*' --sort='-*committerdate' \
  --format='%(*committerdate:short)  %(refname:short)'

# what is inside one of them
git show archive/alternative-sync/s3          # the tag message, then the diff
git log --oneline main..archive/tui
```

Quote `'-*committerdate'` — unquoted, the shell expands the `*` as a glob. It
sorts by the date of the **tagged commit**; plain `creatordate` would sort by
when the tag was made, which is the same day for everything archived in a
sweep.

From the remote, without the local clone being current:

```bash
# names only
gh api repos/oogxdd/type/git/matching-refs/tags/archive \
  --jq '.[] | .ref | sub("refs/tags/";"")'

# names plus the first line of each description
gh api repos/oogxdd/type/git/matching-refs/tags/archive --jq '.[].object.sha' \
  | xargs -I{} gh api repos/oogxdd/type/git/tags/{} \
      --jq '"\(.tag)\n    \(.message | split("\n")[0])"'
```

`matching-refs` does prefix matching, so `.../tags/archive` returns the whole
namespace in one call. The second form needs the extra hop because a ref only
carries the tag object's SHA — the message lives in the tag object itself.

## Archiving something

Tag, push, **verify the tag reached the server**, and only then delete the
branch. The verification step is the point: deleting a branch whose tag failed
to push is how work actually disappears.

```bash
BRANCH=feat/whatever
TAG=archive/2026-09/whatever

git tag -a "$TAG" "$BRANCH" -m "What this was, and why it is shelved."
git push origin "$TAG"

# confirm before deleting anything
# note the ^{} — an annotated tag's own SHA is not the commit's
test "$(git ls-remote origin "refs/tags/$TAG^{}" | cut -f1)" = "$(git rev-parse "$BRANCH")" \
  && echo ok || echo "STOP — tag did not land"

git branch -D "$BRANCH"
git push origin --delete "$BRANCH"
```

## Restoring

```bash
git branch feat/whatever archive/2026-09/whatever
git push -u origin feat/whatever
```

Expect the branch to be far behind `main` — check `git log --oneline
main..<tag>` and the age before planning a merge.

## What is archived now

Descriptions live on the tags themselves (`git tag -l -n 'archive/*'`); this is
the index.

| Tag | Work dated | Size | What it was |
|---|---|---|---|
| `archive/writemd-styling` | 20 Sep | 11 files, +1039/−1270 | The desktop reskin on native window vibrancy, Write.md's visual language |
| `archive/alternative-sync/icloud` | 29 Aug | 8 files, +150/−67 | Notes root in an iCloud folder, letting the drive sync it instead of Git |
| `archive/desktop-state-rehaul` | 8 Aug | 154 files, +3677/−4618 | Desktop frontend without the provider tree: every domain a zustand store, kind-based layout instead of feature slices. Main went the other way |
| `archive/alternative-sync/iroh-without-git` | 12 Aug | 31 files, +3342/−179 | Dropping Git as the sync engine (iroh-docs + gossip), plus the standalone zero-knowledge sync peer at `9dac9d77` — two approaches in one tag |
| `archive/tui` | 17 Aug | 27 files, +9193 | A full terminal shell, `crates/type-tui` (ratatui), 19 commits |
| `archive/2026-09/mobile-audio-transcription` | 10 Aug | 18 files, +1164 | Importing existing phone audio as recording notes (Rust half later landed in `main` separately) |
| `archive/2026-09/mobile-assemblyai` | 8 Aug | 18 files, +1460 | Verifiable, opt-in AssemblyAI setup on the phone, with a stub-server test suite |
| `archive/alternative-sync/s3` | 7 Aug | 42 files, +7211 | Sync over S3-compatible object storage, end-to-end encrypted |
| `archive/2026-09/approval-on-sync` | 10 Jul | 28 files, +1741/−162 | "Ask before syncing": a request-only daemon that hands port 9418 to the Git server after approval |
| `archive/react-native-monorepo-v1.0.0` | 10 Jul | — | Pre-existing: the monorepo at the React Native cutover |
| `archive/2026-09/ios-app` | 24 Jun | 64 files, +10231 | The native Swift iOS app, before React Native |

## Not this scheme

Some older tags mark **a point in `main`'s history** before a big change, rather
than a shelved branch. Different purpose, left as they are:

```
checkpoint-pre-iroh   pre-react-native   pre-pager-approach
backup-2026-06-07     rollback/react-native-monorepo-pre-merge-20260706
```
