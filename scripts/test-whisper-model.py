"""Synthetic regression checks for the embedded model loader (no ML downloads)."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True

SOURCE = Path(__file__).resolve().parents[1] / "crates/type-core/src/adapters/recordings/whisper_scripts/model.py"
spec = importlib.util.spec_from_file_location("whisper_model_loader", SOURCE)
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


class MissingSnapshot(Exception):
    pass


class ModelLoadingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "moved model"
        self.path.mkdir()
        for name in ("model.bin", "config.json", "tokenizer.json"):
            (self.path / name).write_text("fixture")
        self.model = Mock(return_value="loaded")
        self.download = Mock(return_value=str(self.path))
        faster = types.ModuleType("faster_whisper")
        faster.WhisperModel = self.model
        utils = types.ModuleType("faster_whisper.utils")
        utils.download_model = self.download
        errors = types.ModuleType("huggingface_hub.errors")
        errors.LocalEntryNotFoundError = MissingSnapshot
        context = patch.dict(sys.modules, {"faster_whisper": faster, "faster_whisper.utils": utils, "huggingface_hub.errors": errors})
        context.start()
        self.addCleanup(context.stop)

    def test_moved_cached_model_uses_read_only_lookup_and_direct_path(self):
        self.assertEqual(loader.load_model("large-v3", device="cpu"), "loaded")
        self.download.assert_called_once_with("large-v3", local_files_only=True)
        self.model.assert_called_once_with(str(self.path), device="cpu")

    def test_explicit_directory_skips_hub(self):
        loader.load_model("  " + str(self.path) + "  ")
        self.download.assert_not_called()
        self.model.assert_called_once_with(str(self.path))

    def test_missing_explicit_path_is_actionable_and_never_downloads(self):
        with self.assertRaisesRegex(FileNotFoundError, "model.bin is missing"):
            loader.load_model(str(self.path / "old-location"))
        self.download.assert_not_called()
        self.model.assert_not_called()

    def test_absent_snapshot_keeps_first_download_supported(self):
        self.download.side_effect = MissingSnapshot()
        loader.load_model("small")
        self.model.assert_called_once_with("small")

    def test_partial_snapshot_downloads_missing_files(self):
        (self.path / "model.bin").unlink()
        loader.load_model("small")
        self.model.assert_called_once_with("small")

    def test_local_load_failure_does_not_fall_back_to_network(self):
        self.model.side_effect = PermissionError("fixture cache unavailable")
        with self.assertRaises(PermissionError):
            loader.load_model("large-v3")
        self.assertEqual(self.model.call_count, 1)


if __name__ == "__main__":
    unittest.main()
