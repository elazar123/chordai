"""Entry point for a single song analysis.

Run by the Node server as a subprocess. Progress is streamed to stdout as one
JSON object per line so the server can forward it to the browser live; the final
sheet is written to the --out file.
"""

import argparse
import json
import os
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor


def _has_content(audio_path, threshold=0.005):
    """True when a stem carries real signal rather than near-silence."""
    try:
        import soundfile
        import numpy as np

        data, _ = soundfile.read(audio_path, dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        return float(np.sqrt(np.mean(np.square(data)))) > threshold
    except Exception:  # noqa: BLE001 - if we cannot tell, assume it is usable
        return True


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def progress(stage, pct, message):
    emit({"type": "progress", "stage": stage, "pct": round(pct, 1), "message": message})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--language", default=None, help="ISO code, or omit to detect")
    parser.add_argument("--whisper-model", default="medium")
    parser.add_argument("--skip-lyrics", action="store_true")
    parser.add_argument(
        "--separate",
        action="store_true",
        help="split vocals from instruments first (slower, much more accurate)",
    )
    parser.add_argument("--device", default="mps", help="mps or cpu, for separation")
    args = parser.parse_args()

    try:
        import chords as chord_module
        import lyrics as lyrics_module
        import align

        chord_source = args.audio
        lyrics_source = args.audio
        stems_dir = None
        separated = False

        if args.separate:
            import separate as separate_module

            stems_dir = os.path.join(
                os.path.dirname(args.out), f"stems_{os.getpid()}"
            )
            vocals, accompaniment, _ = separate_module.separate(
                args.audio,
                stems_dir,
                device=args.device,
                progress=lambda pct, msg: progress("separate", pct * 0.20, msg),
            )
            if vocals and accompaniment:
                separated = True
                lyrics_source = vocals
                # An a cappella or spoken recording leaves an almost silent
                # accompaniment; chords must then come from the original mix.
                if _has_content(accompaniment):
                    chord_source = accompaniment
            else:
                progress("separate", 20, "ההפרדה לא הצליחה — ממשיך על המקור")

        language = None if args.language in (None, "", "auto") else args.language
        empty_transcription = {
            "language": args.language or "unknown",
            "segments": [],
            "words": [],
        }

        def run_chords():
            return chord_module.analyze(chord_source, progress=None)

        def run_lyrics():
            if args.skip_lyrics:
                return empty_transcription
            return lyrics_module.transcribe(
                lyrics_source,
                model_size=args.whisper_model,
                language=language,
                clean_vocals=separated,
                # Transcription is the long pole, so it drives the progress bar.
                progress=lambda pct, msg: progress("lyrics", 20 + pct * 0.76, msg),
            )

        # The two stages read different stems and share no state, so they run
        # together. Both spend their time in native code that releases the GIL.
        progress("analyze", 22, "מזהה אקורדים ומתמלל מילים")
        with ThreadPoolExecutor(max_workers=2) as pool:
            chords_future = pool.submit(run_chords)
            lyrics_future = pool.submit(run_lyrics)
            result = chords_future.result()
            transcription = lyrics_future.result()

        if stems_dir:
            separate_module.cleanup(stems_dir)

        progress("align", 96, "מסדר אקורדים מעל המילים")
        blocks = align.build_sheet(result["chords"], transcription)

        sheet = {
            "duration": result["duration"],
            "bpm": result["bpm"],
            "key": result["key"],
            "language": transcription.get("language"),
            "chords": result["chords"],
            "blocks": blocks,
            "hasLyrics": any(b.get("type") == "line" for b in blocks),
            # Kept so the user can later paste the real lyrics and have them
            # re-synced against this timing without re-running transcription.
            "asrWords": transcription.get("words", []),
        }

        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(sheet, handle, ensure_ascii=False)

        progress("done", 100, "הושלם")
        emit({"type": "done", "out": args.out})

    except Exception as error:  # noqa: BLE001 - surface any failure to the server
        emit(
            {
                "type": "error",
                "message": str(error),
                "traceback": traceback.format_exc(),
            }
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
