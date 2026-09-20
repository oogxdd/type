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
holds the sync transports that lost). Use the date otherwise. Either way the
`archive/` prefix is what matters — every listing below globs on it.

Drop noise from the old branch name: `worktree-`, a duplicated `archive/`, an
`agent/` or `codex/` prefix that only records which tool produced it.

Release tags are `desktop-v*` and `mobile-v*`, and the release workflows trigger
on exactly those two patterns — so an `archive/*` tag never starts a build.

## Listing them

The GitHub web UI has no tag search, so use the CLI.

```bash
# every archived item, newest commit first
git tag -l 'archive/*' --sort=-creatordate \
  --format='%(refname:short)  %(objectname:short)  %(creatordate:short)'

# straight from the remote, without a local clone being up to date
gh api repos/oogxdd/type/git/matching-refs/tags/archive \
  --jq '.[] | "\(.ref | sub("refs/tags/";""))  \(.object.sha[0:8])"'

# what is in one of them
git show --stat archive/alternative-sync/s3
git log --oneline main..archive/alternative-sync/s3
```

`gh` needs no special flags here — `matching-refs` does prefix matching, so
`.../tags/archive` returns the whole namespace.

## Archiving something

Tag, push, **verify the tag reached the server**, and only then delete the
branch. The verification step is the point: deleting a branch whose tag failed
to push is how work actually disappears.

```bash
BRANCH=feat/whatever
TAG=archive/2026-09/whatever

git tag "$TAG" "$BRANCH"
git push origin "$TAG"

# confirm before deleting anything
test "$(git ls-remote --tags origin "$TAG" | cut -f1)" = "$(git rev-parse "$BRANCH")" \
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

| Tag | Commits | Size | What it was |
|---|---|---|---|
| `archive/alternative-sync/s3` | 5 | 42 files, +7211 | Sync over S3-compatible object storage, end-to-end encrypted |
| `archive/alternative-sync/icloud` | 1 | 8 files, +150/−67 | Sync by putting the notes root in an iCloud folder instead of Git |
| `archive/2026-09/approval-on-sync` | 5 | 28 files, +1741/−162 | "Ask before syncing": a request-only daemon that hands port 9418 to the real Git server once the desktop approves |
| `archive/2026-09/ios-app` | 10 | 64 files, +10231 | The native Swift iOS app, before the React Native mobile app |
| `archive/2026-09/mobile-assemblyai` | 1 | 18 files, +1460 | Making AssemblyAI setup on the phone verifiable and opt-in, with a stub-server test suite |
| `archive/2026-09/mobile-audio-transcription` | 1 | 18 files, +1164 | Importing existing audio (Voice Memos, Files) as recording notes on the phone |
| `archive/react-native-monorepo-v1.0.0` | — | — | Pre-existing: the monorepo at the React Native cutover |

## Not this scheme

Some older tags mark **a point in `main`'s history** before a big change, rather
than a shelved branch. Different purpose, left as they are:

```
checkpoint-pre-iroh   pre-react-native   pre-pager-approach
backup-2026-06-07     rollback/react-native-monorepo-pre-merge-20260706
```
