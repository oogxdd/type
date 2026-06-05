import sys, json

def main():
    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "large-v3"

    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments, info = model.transcribe(audio_path, word_timestamps=True)

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

    result = {
        "text": " ".join(text_parts).strip(),
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 3),
        "words": words,
    }
    json.dump(result, sys.stdout, ensure_ascii=False)

main()
