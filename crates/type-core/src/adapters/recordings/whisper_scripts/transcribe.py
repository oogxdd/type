import sys, json

def emit(payload):
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()

def main():
    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "large-v3"

    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments, info = model.transcribe(audio_path, word_timestamps=True)

    # info.duration is known before any segment is consumed (faster-whisper
    # resolves it via VAD/decoding up front), so the total is available for
    # an initial 0% progress line — the caller doesn't have to wait for the
    # first segment just to learn how long the audio is.
    duration = round(info.duration, 3)
    emit({"type": "progress", "processed_seconds": 0.0, "total_seconds": duration})

    text_parts = []
    words = []
    for segment in segments:
        text_parts.append(segment.text)
        if segment.words:
            for w in segment.words:
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 3),
                })
        emit({
            "type": "progress",
            "processed_seconds": round(segment.end, 3),
            "total_seconds": duration,
        })

    result = {
        "type": "result",
        "text": " ".join(text_parts).strip(),
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": duration,
        "words": words,
    }
    emit(result)

main()
