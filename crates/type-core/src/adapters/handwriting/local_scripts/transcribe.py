import json
import os
import sys

image_path = sys.argv[1]
model_path = sys.argv[2]
os.makedirs(model_path, exist_ok=True)

try:
    import easyocr

    reader = easyocr.Reader(
        ["en"],
        gpu=False,
        model_storage_directory=model_path,
        download_enabled=True,
        verbose=False,
    )
    paragraphs = reader.readtext(image_path, detail=0, paragraph=True)
    text = "\n\n".join(value.strip() for value in paragraphs if value.strip())
    print(json.dumps({"text": text, "error": None}, ensure_ascii=False))
except Exception as error:
    print(json.dumps({"text": "", "error": str(error)}, ensure_ascii=False))
