"""Vocal separation with Demucs.

Splitting the song into a vocal stem and an instrumental stem before analysis
helps both halves of the pipeline: Whisper stops fighting the band, and the
chord detector stops seeing the singer's melody as harmony.
"""

import os
import shutil
import subprocess
import sys

MODEL = "htdemucs"


def _stem_paths(out_dir, audio_path):
    name = os.path.splitext(os.path.basename(audio_path))[0]
    folder = os.path.join(out_dir, MODEL, name)
    return (
        os.path.join(folder, "vocals.wav"),
        os.path.join(folder, "no_vocals.wav"),
        folder,
    )


def separate(audio_path, out_dir, device="mps", progress=None):
    """Split audio into (vocals, accompaniment).

    Returns (vocals_path, accompaniment_path, cleanup_dir). On any failure it
    returns (None, None, None) so the caller can fall back to the original mix —
    separation is an enhancement, never a hard requirement.
    """
    if progress:
        progress(5, "מפריד את הקול מהכלים")

    os.makedirs(out_dir, exist_ok=True)

    for attempt_device in ([device, "cpu"] if device != "cpu" else ["cpu"]):
        command = [
            sys.executable, "-m", "demucs",
            "--two-stems=vocals",
            "-n", MODEL,
            "-d", attempt_device,
            "-o", out_dir,
            audio_path,
        ]
        try:
            subprocess.run(
                command,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=45 * 60,
            )
        except subprocess.CalledProcessError as error:
            detail = (error.stderr or b"").decode("utf-8", "replace").strip()
            # MPS occasionally fails on this model; CPU is slower but reliable.
            print(f"demucs failed on {attempt_device}: {detail[-400:]}", file=sys.stderr)
            continue
        except Exception as error:  # noqa: BLE001
            print(f"demucs error on {attempt_device}: {error}", file=sys.stderr)
            continue

        vocals, accompaniment, folder = _stem_paths(out_dir, audio_path)
        if os.path.exists(vocals) and os.path.exists(accompaniment):
            if progress:
                progress(100, "ההפרדה הושלמה")
            return vocals, accompaniment, folder

    return None, None, None


def cleanup(out_dir):
    """Stems are large and only needed during the run."""
    shutil.rmtree(out_dir, ignore_errors=True)
