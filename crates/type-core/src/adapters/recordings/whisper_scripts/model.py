import os

def load_model(model_name, **options):
    """Read an existing snapshot directly; Hub refresh must not break local work."""
    from faster_whisper import WhisperModel
    from faster_whisper.utils import download_model
    from huggingface_hub.errors import LocalEntryNotFoundError

    model_name = os.path.expanduser(model_name.strip())
    if os.path.isabs(model_name) or model_name.startswith(("./", "../")):
        if not os.path.isfile(os.path.join(model_name, "model.bin")):
            raise FileNotFoundError("Whisper model.bin is missing at: " + model_name)
        return WhisperModel(model_name, **options)

    # snapshot_download's normal path checks the Hub and updates refs even if
    # weights already exist. The offline lookup is read-only and follows a moved
    # cache symlink. Download only when there is no complete local snapshot.
    try:
        cached = download_model(model_name, local_files_only=True)
    except LocalEntryNotFoundError:
        cached = None
    if cached and all(os.path.isfile(os.path.join(cached, name))
                      for name in ("model.bin", "config.json", "tokenizer.json")):
        return WhisperModel(cached, **options)
    return WhisperModel(model_name, **options)
