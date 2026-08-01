"""Lyrics transcription with word-level timing, via faster-whisper.

Word timings are what let the app place each chord above the exact syllable it
lands on, so we always ask for them even though they cost a little extra time.
"""

import os

_model_cache = {}


def _load_model(model_size):
    if model_size not in _model_cache:
        from faster_whisper import WhisperModel

        # int8 on CPU is the sweet spot on Apple Silicon: close to float16 quality
        # at a fraction of the memory, and no GPU setup to go wrong.
        _model_cache[model_size] = WhisperModel(
            model_size,
            device="cpu",
            compute_type="int8",
            download_root=os.environ.get("CHORDAI_MODEL_DIR") or None,
        )
    return _model_cache[model_size]


def transcribe(
    audio_path, model_size="medium", language=None, progress=None, clean_vocals=False
):
    """Transcribe audio to timed words.

    Returns {"language": str, "words": [{start, end, text}], "segments": [...]}.
    `language` may be None to auto-detect, or an ISO code such as "he" / "en".
    """

    def report(pct, message):
        if progress:
            progress(pct, message)

    report(5, "טוען מודל תמלול")
    model = _load_model(model_size)

    report(15, "מתמלל מילים")
    # Voice activity detection exists to stop Whisper inventing lyrics over
    # instrumental passages. On an isolated vocal stem there is no band to
    # hallucinate over, so strict VAD only throws away real singing: on a test
    # song it cut the transcript from 46 words to 20. Relax it when the audio is
    # already a clean vocal, keep it tight when we are handed the full mix.
    vad_parameters = (
        {"min_silence_duration_ms": 2000, "threshold": 0.25}
        if clean_vocals
        else {"min_silence_duration_ms": 700}
    )

    segments, info = model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        beam_size=5,
        vad_filter=True,
        vad_parameters=vad_parameters,
        condition_on_previous_text=False,
    )

    words, out_segments = [], []
    total = max(float(getattr(info, "duration", 0.0)), 1.0)

    for segment in segments:
        seg_words = []
        for word in segment.words or []:
            text = word.word.strip()
            if not text:
                continue
            entry = {
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
                "text": text,
            }
            words.append(entry)
            seg_words.append(entry)

        if seg_words:
            out_segments.append(
                {
                    "start": round(float(segment.start), 3),
                    "end": round(float(segment.end), 3),
                    "text": segment.text.strip(),
                    "words": seg_words,
                }
            )

        pct = 15 + min(80.0, (float(segment.end) / total) * 80.0)
        report(pct, "מתמלל מילים")

    return {
        "language": getattr(info, "language", language) or "unknown",
        "words": words,
        "segments": out_segments,
    }
