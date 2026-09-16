#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("migration", Path(__file__).with_name("prepare-audio-history-migration.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class AudioHistoryMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="type-history-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "notes"
        self.root.mkdir()
        migration.git(self.root, "init", "-b", "main")
        migration.git(self.root, "config", "user.name", "Test")
        migration.git(self.root, "config", "user.email", "test@example.invalid")
        (self.root / "Feed").mkdir()
        (self.root / "Recordings").mkdir()
        (self.root / "_Recordings").mkdir()
        (self.root / "Feed/note.md").write_text("first version\n")
        (self.root / "Recordings/audio.m4a").write_bytes(b"historical audio" * 100)
        (self.root / "_Recordings/old.m4a").write_bytes(b"old directory")
        self.commit("first")

    def commit(self, message):
        migration.git(self.root, "add", ".")
        migration.git(self.root, "commit", "-m", message)

    def test_preserves_history_merges_current_edits_and_audio_without_mutating_source(self):
        migration.git(self.root, "checkout", "-b", "other")
        (self.root / "Feed/other.md").write_text("branch content")
        self.commit("other branch")
        migration.git(self.root, "checkout", "main")
        (self.root / "Feed/note.md").write_text("second version\n")
        self.commit("second")
        migration.git(self.root, "merge", "--no-ff", "other", "-m", "merge")
        migration.git(self.root, "tag", "-a", "saved", "-m", "checkpoint")
        migration.git(self.root, "update-ref", "refs/remotes/computer/main", "HEAD")
        (self.root / "Recordings/audio.m4a").write_bytes(b"changed audio")
        self.commit("audio only")
        (self.root / "Recordings/audio.m4a").unlink()
        self.commit("removed audio")
        (self.root / "Feed/note.md").write_text("unsaved to git\n")
        (self.root / "Feed/new.md").write_text("untracked note\n")
        (self.root / "Recordings/new.m4a").write_bytes(b"new untracked audio")
        (self.root / ".type").mkdir()
        (self.root / ".type/device.json").write_text('{"git_remote_url":"ssh://old/notes","git_iroh_ticket":"old-ticket"}')
        before = migration.manifest(self.root)
        dest = self.base / "prepared"
        report = migration.prepare(self.root, dest, apps_stopped=True)
        self.assertTrue(report["verified"])
        self.assertEqual(report["commits_preserved"], 6)
        self.assertEqual(migration.manifest(self.root), before)
        self.assertEqual(migration.manifest(dest / "original"), before)
        self.assertEqual((dest / "migrated/Recordings/new.m4a").read_bytes(), b"new untracked audio")
        self.assertEqual(migration.git(dest / "migrated", "remote"), b"")
        self.assertEqual(migration.git(dest / "migrated", "ls-files", "Recordings", "_Recordings"), b"")
        # Historical audio is absent even from the new object database.
        initial = migration.git(self.root, "rev-list", "--max-parents=0", "HEAD").strip().decode()
        old_audio = migration.git(self.root, "rev-parse", initial + ":Recordings/audio.m4a").strip().decode()
        with self.assertRaises(RuntimeError):
            migration.git(dest / "migrated", "cat-file", "-e", old_audio)
        self.assertEqual((dest / "migrated/Feed/note.md").read_text(), "unsaved to git\n")

    def test_refuses_overwrite_nested_destination_and_running_app(self):
        before = migration.manifest(self.root)
        for destination, stopped in [(self.root, True), (self.root / "copy", True),
                                     (self.base, True), (self.base / "new", False)]:
            with self.assertRaises(RuntimeError):
                migration.prepare(self.root, destination, apps_stopped=stopped)
        self.assertEqual(migration.manifest(self.root), before)


if __name__ == "__main__":
    unittest.main()
