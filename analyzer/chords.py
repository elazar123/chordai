"""Chord recognition from audio.

Beat-synchronous chroma features matched against chord templates, then decoded
with Viterbi so the chord track stays stable instead of flickering frame to frame.
"""

import numpy as np
import librosa
import scipy.ndimage

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Root-relative semitone sets. Order matters: earlier entries win ties, so the
# plain triads sit at the top and richer voicings need to clearly beat them.
CHORD_QUALITIES = [
    ("", [0, 4, 7], 1.00),        # major
    ("m", [0, 3, 7], 1.00),       # minor
    ("7", [0, 4, 7, 10], 0.94),
    ("m7", [0, 3, 7, 10], 0.94),
    ("maj7", [0, 4, 7, 11], 0.92),
    ("sus4", [0, 5, 7], 0.90),
    ("sus2", [0, 2, 7], 0.88),
    ("dim", [0, 3, 6], 0.86),
    ("m6", [0, 3, 7, 9], 0.84),
    ("6", [0, 4, 7, 9], 0.84),
    ("aug", [0, 4, 8], 0.80),
]

# Krumhansl-Kessler key profiles, used to name the key of the whole track.
MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def build_templates():
    """Return (templates, labels, weights) for every root/quality combination.

    Templates are L2-normalised so that cosine similarity does not automatically
    favour four-note chords over triads.
    """
    templates, labels, weights = [], [], []
    for root in range(12):
        for suffix, intervals, weight in CHORD_QUALITIES:
            vec = np.zeros(12)
            for interval in intervals:
                vec[(root + interval) % 12] = 1.0
            # Root and fifth carry the identity of the chord; emphasise them so a
            # missing or weak third does not flip major/minor at random.
            vec[root] *= 1.35
            vec[(root + 7) % 12] *= 1.10
            vec /= np.linalg.norm(vec)
            templates.append(vec)
            labels.append(PITCH_CLASSES[root] + suffix)
            weights.append(weight)
    # Final state: "no chord" (silence, applause, spoken intro).
    templates.append(np.full(12, 1.0 / np.sqrt(12)))
    labels.append("N")
    weights.append(0.55)
    return np.array(templates), labels, np.array(weights)


# Scale degrees and the triad quality each one normally takes.
MAJOR_DEGREES = {0: "maj", 2: "min", 4: "min", 5: "maj", 7: "maj", 9: "min", 11: "dim"}
MINOR_DEGREES = {0: "min", 2: "dim", 3: "maj", 5: "min", 7: "min", 8: "maj", 10: "maj"}


def base_quality(suffix):
    """Reduce a chord suffix to its underlying triad type."""
    if suffix.startswith("maj"):
        return "maj"
    if suffix.startswith("m"):
        return "min"
    if suffix.startswith("dim"):
        return "dim"
    if suffix.startswith("aug"):
        return "aug"
    if suffix.startswith("sus"):
        return "sus"
    return "maj"


def split_chord(label):
    """'F#m7' -> (6, 'min'). Returns (None, None) for 'N' or anything unparsable."""
    if not label or label == "N":
        return None, None
    root = label[:2] if len(label) > 1 and label[1] == "#" else label[:1]
    if root not in PITCH_CLASSES:
        return None, None
    return PITCH_CLASSES.index(root), base_quality(label[len(root):])


def detect_key_from_chords(chords):
    """Infer the key from which chords are played and for how long.

    Far more reliable than correlating raw chroma: it works off the harmony the
    detector already committed to, and it is unaffected by whether the vocal
    track is present in the audio being analysed.
    """
    parsed = []
    for segment in chords:
        root, quality = split_chord(segment["chord"])
        if root is not None:
            parsed.append((root, quality, max(0.0, segment["end"] - segment["start"])))

    if not parsed:
        return None

    total = sum(item[2] for item in parsed) or 1.0
    best_score, best_key = -1.0, None

    for tonic in range(12):
        for degrees, mode in ((MAJOR_DEGREES, "major"), (MINOR_DEGREES, "minor")):
            score = 0.0
            for root, quality, duration in parsed:
                degree = (root - tonic) % 12
                expected = degrees.get(degree)
                if expected is None:
                    continue
                if expected == quality:
                    score += duration * 2.0
                elif mode == "minor" and degree == 7 and quality == "maj":
                    # A major V in a minor key (harmonic minor) is very common.
                    score += duration * 1.8
                else:
                    score += duration * 0.7

            # Songs overwhelmingly start and end on the tonic.
            if parsed[-1][0] == tonic:
                score += total * 0.18
            if parsed[0][0] == tonic:
                score += total * 0.06

            if score > best_score:
                best_score, best_key = score, f"{PITCH_CLASSES[tonic]} {mode}"

    return best_key


def detect_key(chroma):
    """Correlate the average chroma against key profiles. Returns e.g. 'G major'."""
    avg = chroma.mean(axis=1)
    if avg.sum() <= 0:
        return None
    avg = avg / avg.sum()

    best_score, best_key = -np.inf, None
    for root in range(12):
        for profile, name in ((MAJOR_PROFILE, "major"), (MINOR_PROFILE, "minor")):
            rotated = np.roll(profile, root)
            score = np.corrcoef(avg, rotated / rotated.sum())[0, 1]
            if score > best_score:
                best_score, best_key = score, f"{PITCH_CLASSES[root]} {name}"
    return best_key


def analyze(audio_path, sr=22050, progress=None):
    """Run the full chord pipeline. Returns a dict with chords, bpm, key, duration."""

    def report(pct, message):
        if progress:
            progress(pct, message)

    report(5, "טוען את הקובץ")
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    report(15, "מפריד כלים הרמוניים מכלי הקצב")
    # Percussion smears energy across all pitch classes and ruins the chroma, so
    # we keep only the harmonic part before extracting pitch content.
    y_harmonic = librosa.effects.harmonic(y, margin=3.0)

    report(30, "מחשב פרופיל צלילים")
    chroma = librosa.feature.chroma_cqt(
        y=y_harmonic, sr=sr, bins_per_octave=36, n_octaves=7
    )
    # Horizontal median filter removes single-frame spikes from passing notes.
    chroma = scipy.ndimage.median_filter(chroma, size=(1, 9))

    report(45, "מזהה קצב ופעימות")
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    bpm = float(np.atleast_1d(tempo)[0])

    if len(beats) < 4:
        # Very short or arrhythmic audio: fall back to a fixed grid so the rest of
        # the pipeline still has segments to work with.
        frames = np.arange(0, chroma.shape[1], max(1, int(sr / 512)))
        beats = frames

    # sync() emits one column per beat *plus* a leading column for the audio
    # before the first beat, so the boundaries run 0 -> beat[0] -> ... -> duration.
    beat_times = np.concatenate(
        [[0.0], librosa.frames_to_time(beats, sr=sr), [duration]]
    )

    # One chroma vector per beat: chords change on beats far more often than they
    # change mid-beat, and this makes the Viterbi pass cheap.
    sync_chroma = librosa.util.sync(chroma, beats, aggregate=np.median)
    if sync_chroma.shape[1] < 1:
        return {"chords": [], "bpm": bpm, "key": None, "duration": duration}

    report(60, "מתאים אקורדים")
    templates, labels, weights = build_templates()

    norms = np.linalg.norm(sync_chroma, axis=0, keepdims=True)
    energy = norms[0].copy()
    norms[norms == 0] = 1e-9
    normed = sync_chroma / norms

    similarity = templates @ normed          # (n_states, n_beats)
    similarity *= weights[:, None]

    # Beats with almost no harmonic energy are silence, not chords.
    quiet = energy < (np.median(energy) * 0.18)
    similarity[-1, quiet] += 0.6

    # Softmax turns similarities into the emission probabilities Viterbi expects.
    scaled = similarity * 12.0
    scaled -= scaled.max(axis=0, keepdims=True)
    probs = np.exp(scaled)
    probs /= probs.sum(axis=0, keepdims=True)

    n_states = len(labels)
    self_prob = 0.55
    transition = np.full((n_states, n_states), (1.0 - self_prob) / (n_states - 1))
    np.fill_diagonal(transition, self_prob)

    path = librosa.sequence.viterbi(probs, transition)

    report(80, "מארגן את רצף האקורדים")
    chords = _segments_from_path(path, labels, beat_times)
    chords = _merge_short_segments(chords)

    # Prefer the harmony-based estimate; fall back to chroma when no chord was
    # confidently detected at all.
    key = detect_key_from_chords(chords) or detect_key(chroma)

    return {
        "chords": chords,
        "bpm": round(bpm, 1),
        "key": key,
        "duration": duration,
    }


def _segments_from_path(path, labels, beat_times):
    """Collapse a per-beat state path into contiguous chord segments."""
    segments = []
    for i, state in enumerate(path):
        label = labels[state]
        start = float(beat_times[i])
        end = float(beat_times[min(i + 1, len(beat_times) - 1)])
        if segments and segments[-1]["chord"] == label:
            segments[-1]["end"] = end
        else:
            segments.append({"chord": label, "start": start, "end": end})
    return segments


def _merge_short_segments(segments, min_duration=0.45):
    """Absorb blink-and-miss chords into their neighbours.

    A chord shorter than a fraction of a bar is almost always a detection glitch
    rather than something a player would actually strum.
    """
    if not segments:
        return segments

    result = []
    for seg in segments:
        if seg["end"] - seg["start"] < min_duration and result:
            result[-1]["end"] = seg["end"]
        else:
            result.append(dict(seg))

    # A second pass joins neighbours that became identical after merging.
    merged = [result[0]]
    for seg in result[1:]:
        if seg["chord"] == merged[-1]["chord"]:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg)

    for seg in merged:
        seg["start"] = round(seg["start"], 3)
        seg["end"] = round(seg["end"], 3)
    return merged
