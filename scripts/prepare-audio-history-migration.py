#!/usr/bin/env python3
"""Prepare and verify a separate notes-root copy with audio-free Git history.

Never modifies the source or contacts a remote. See docs/AUDIO_HISTORY_MIGRATION.md.
Requires Python 3.10+, Git, and git-filter-repo 2.47.0.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

AUDIO_DIRS = (b"Recordings", b"_Recordings")


def git(root, *args, data=None):
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_REPLACE_OBJECTS": "1"}
    # Do not let the caller's Git shell variables redirect writes to another repo.
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
                 "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR"):
        env.pop(name, None)
    result = subprocess.run(["git", "-C", str(root), *args], input=data,
                            capture_output=True, env=env)
    if result.returncode:
        raise RuntimeError(f"git {args[0]} failed: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def manifest(root):
    """Hash every regular file, including ignored audio and unreachable Git objects."""
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in list(dirs):
            path = Path(directory) / name
            if path.is_symlink():
                raise RuntimeError("Symlinked directories are unsupported; use a self-contained notes root.")
        for name in files:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                raise RuntimeError("Symlinked files are unsupported; use a self-contained notes root.")
            elif path.is_file():
                digest = hashlib.sha256()
                with path.open("rb") as file:
                    for chunk in iter(lambda: file.read(1024 * 1024), b""):
                        digest.update(chunk)
                result[relative] = digest.hexdigest()
            else:
                raise RuntimeError("The notes root contains a special file; migration stopped.")
    return result


def text_tree(root, commit):
    entries = git(root, "ls-tree", "-rz", "--full-tree", commit).split(b"\0")
    return [entry for entry in entries if entry and
            entry.split(b"\t", 1)[1].split(b"/", 1)[0] not in AUDIO_DIRS]


def commit_parts(root, oid):
    header, message = git(root, "cat-file", "commit", oid).split(b"\n\n", 1)
    lines = header.splitlines()
    identity = [line for line in lines if line.startswith((b"author ", b"committer ", b"encoding "))]
    parents = [line[7:].decode() for line in lines if line.startswith(b"parent ")]
    return identity, message, parents


def migration_ref(ref):
    if ref.startswith(("refs/heads/", "refs/tags/")):
        return ref
    # Remote-only commits and stashes must survive, but must not remain wired
    # to old peers. Preserve them as local recovery branches.
    return "refs/heads/type-migration/" + ref.removeprefix("refs/")


def verify_history(source, target):
    mapping = {}
    for line in (target / ".git/filter-repo/commit-map").read_text().splitlines()[1:]:
        old, new = line.split()
        if set(new) == {"0"}:
            raise RuntimeError("A historical commit was removed.")
        mapping[old] = new
    originals = git(source, "rev-list", "--all").decode().splitlines()
    if set(originals) != set(mapping):
        raise RuntimeError("The commit map does not cover the complete source history.")
    for old, new in mapping.items():
        if text_tree(source, old) != text_tree(target, new):
            raise RuntimeError(f"Non-audio content changed in commit {old}.")
        # There must not be excluded files hidden in another branch or merge.
        if git(target, "ls-tree", "-rz", "--full-tree", new).split(b"\0")[:-1] != text_tree(target, new):
            raise RuntimeError("Audio is still reachable in the rewritten history.")
        old_identity, old_message, parents = commit_parts(source, old)
        new_identity, new_message, new_parents = commit_parts(target, new)
        if (old_identity, old_message, [mapping[parent] for parent in parents]) != (new_identity, new_message, new_parents):
            raise RuntimeError(f"Commit metadata or merge topology changed for {old}.")
    for line in git(source, "for-each-ref", "--format=%(refname)").decode().splitlines():
        old = git(source, "rev-parse", line + "^{commit}").decode().strip()
        new = git(target, "rev-parse", migration_ref(line) + "^{commit}").decode().strip()
        if mapping[old] != new:
            raise RuntimeError("A branch or tag does not point to its rewritten commit.")
    git(target, "fsck", "--full", "--strict")
    return len(mapping)


def prepare(source, destination, apps_stopped=False):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not apps_stopped:
        raise RuntimeError("Stop Type and its sync server on all devices, then pass --apps-stopped.")
    if destination == source or source in destination.parents or destination in source.parents:
        raise RuntimeError("Destination must be separate from the source tree.")
    if destination.exists():
        raise RuntimeError("Destination must not exist; no existing files will be overwritten.")
    if not (source / ".git").is_dir() or (source / ".git").is_symlink():
        raise RuntimeError("Source must be a notes root with its own regular .git directory.")
    if not (source / "Feed").is_dir():
        raise RuntimeError("Source must be a Type notes root (Feed is missing).")
    if git(source, "rev-parse", "--is-shallow-repository").strip() != b"false":
        raise RuntimeError("Shallow repositories cannot preserve complete history.")
    if (source / ".git/objects/info/alternates").exists():
        raise RuntimeError("Repositories with shared object storage are unsupported.")
    if git(source, "for-each-ref", "refs/replace").strip() or (source / ".git/info/grafts").exists():
        raise RuntimeError("Replace refs and grafts must be resolved before migration.")
    if any((source / ".git").rglob("*.lock")):
        raise RuntimeError("Git is busy; found a lock file.")
    if git(source, "ls-files", "--unmerged").strip() or any(
        (source / ".git" / name).exists() for name in
        ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")
    ):
        raise RuntimeError("Finish the active Git operation before migration.")
    branch = git(source, "symbolic-ref", "HEAD").decode().strip()
    git(source, "rev-parse", "HEAD")
    spec = importlib.util.find_spec("git_filter_repo")
    if spec is None:
        raise RuntimeError("Install git-filter-repo==2.47.0 in this Python environment first.")
    before = manifest(source)
    destination.mkdir(parents=True)
    original, migrated = destination / "original", destination / "migrated"
    shutil.copytree(source, original, symlinks=True)
    if manifest(original) != before or manifest(source) != before:
        raise RuntimeError("Source changed during backup. Keep Type stopped and retry into a new directory.")
    shutil.copytree(original, migrated, symlinks=True,
                    ignore=lambda path, names: [".git"] if Path(path) == original else [])
    # --no-local gives an independent object database, with no hard links or
    # alternates. All refs (including local branches and stashes) are copied.
    git(destination, "clone", "--mirror", "--no-local", str(original), str(migrated / ".git"))
    refs = git(original, "for-each-ref", "--format=%(refname)").decode().splitlines()
    for ref in refs:
        mapped = migration_ref(ref)
        if mapped != ref:
            if mapped in refs:
                raise RuntimeError("A recovery branch name already exists; migration stopped.")
            oid = git(original, "rev-parse", ref + "^{commit}").decode().strip()
            git(migrated / ".git", "update-ref", mapped, oid)
            git(migrated / ".git", "update-ref", "-d", ref)
    # Force applies ONLY to this newly created independent copy, after moving
    # remote refs to recovery branches. The source is never filtered.
    subprocess.run([sys.executable, spec.origin, "--force", "--invert-paths",
                    "--path", "Recordings/", "--path", "_Recordings/",
                    "--prune-empty", "never", "--prune-degenerate", "never",
                    "--preserve-commit-hashes", "--preserve-commit-encoding"],
                   cwd=migrated / ".git", check=True, capture_output=True)
    git(migrated / ".git", "config", "core.bare", "false")
    git(migrated, "symbolic-ref", "HEAD", branch)
    git(migrated, "read-tree", "HEAD")  # populate index, never overwrite current files
    exclude = migrated / ".git/info/exclude"
    exclude.parent.mkdir(exist_ok=True)
    previous = original / ".git/info/exclude"
    exclude.write_bytes((previous.read_bytes() if previous.exists() else b"") +
                        b"\n/Recordings/\n/_Recordings/\n/.type/device.json\n/.type/audio-cache.json\n")
    # Deliberately keep this prepared copy disconnected from the old history.
    # Git-filter-repo removes origin; remove any other remotes as well.
    for remote in git(migrated, "remote").decode().splitlines():
        git(migrated, "remote", "remove", remote)
    device = migrated / ".type/device.json"
    if device.exists():
        settings = json.loads(device.read_text())
        for key in ("git_remote_url", "git_iroh_ticket", "git_username", "git_password",
                    "git_trusted_ssh_host", "git_trusted_ssh_host_key_sha256"):
            settings[key] = ""
        device.write_text(json.dumps(settings, indent=2) + "\n")
    count = verify_history(original, migrated)
    copied = manifest(migrated)
    for path, digest in before.items():
        if path.startswith(".git/") or path == ".type/device.json":
            continue
        if copied.get(path) != digest:
            raise RuntimeError("A current file changed while preparing the migrated copy.")
    if manifest(source) != before:
        raise RuntimeError("Source changed during migration; do not activate this copy.")
    report = {"verified": True, "commits_preserved": count,
              "source_unchanged": True, "current_files_preserved": True,
              "audio_removed_from_history": [name.decode() for name in AUDIO_DIRS],
              "original_git_bytes": sum(p.stat().st_size for p in (original / ".git").rglob("*") if p.is_file()),
              "migrated_git_bytes": sum(p.stat().st_size for p in (migrated / ".git").rglob("*") if p.is_file()),
              "activation": "NOT ACTIVATED. Recreate phone working folders from the new desktop history; never merge old clones."}
    (destination / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--apps-stopped", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.source, args.destination, args.apps_stopped), indent=2))
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Migration not activated: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
