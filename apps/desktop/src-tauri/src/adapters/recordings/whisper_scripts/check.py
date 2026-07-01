import json, sys
try:
    from faster_whisper import WhisperModel
    model_size = sys.argv[1] if len(sys.argv) > 1 else None
    available = True
    error = None

    if model_size:
        try:
            # Try to load the model to verify it's available.
            # This will trigger a download if model_size is a name and not yet cached.
            # We use CPU and int8 for a lightweight check.
            WhisperModel(model_size, device="cpu", compute_type="int8", local_files_only=False)
        except Exception as e:
            available = False
            error = str(e)

    json.dump({"available": available, "error": error}, sys.stdout)
except Exception as e:
    available = False
    error = str(e)
    json.dump({"available": available, "error": error}, sys.stdout)
