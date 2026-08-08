import json
import os
import sys

model_path = sys.argv[1]
os.makedirs(model_path, exist_ok=True)

try:
    import easyocr

    easyocr.Reader(
        ["en"],
        gpu=False,
        model_storage_directory=model_path,
        download_enabled=True,
        verbose=False,
    )
    print(json.dumps({"available": True, "error": None}))
except Exception as error:
    print(json.dumps({"available": False, "error": str(error)}))
