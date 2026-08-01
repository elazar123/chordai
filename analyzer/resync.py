"""Re-sync a chord sheet to the real lyrics.

Automatic transcription of sung Hebrew is never reliably correct. When the user
pastes the actual lyrics, we keep their words verbatim and borrow the timing from
the transcription by aligning the two word sequences against each other.

Reads a job file on stdin-style argv and writes the new blocks to --out:
    {"chords": [...], "asrWords": [{start,end,text}], "lyrics": "line\\nline"}
"""

import argparse
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher

import align

# Hebrew combining marks: niqqud, cantillation, and the like.
NIQQUD = re.compile(r"[֑-ׇ]")
PUNCT = re.compile(r"[^\w֐-׿]+", re.UNICODE)
FINALS = str.maketrans("ךםןףץ", "כמנפצ")

MATCH_THRESHOLD = 0.62    # below this, two words are not the same word
GAP_PENALTY = -0.6


def normalise(word):
    """Strip everything that should not affect whether two words count as equal."""
    text = unicodedata.normalize("NFKD", word)
    text = NIQQUD.sub("", text)
    text = PUNCT.sub("", text)
    return text.translate(FINALS).lower().strip()


def similarity(a, b):
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def align_sequences(target, source):
    """Needleman-Wunsch alignment of pasted words against transcribed words.

    Returns a list the same length as `target`, holding the index into `source`
    each target word matched, or None where it matched nothing.
    """
    n, m = len(target), len(source)
    if n == 0 or m == 0:
        return [None] * n

    # score[i][j] = best score aligning target[:i] with source[:j]
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        score[i][0] = score[i - 1][0] + GAP_PENALTY
    for j in range(1, m + 1):
        score[0][j] = score[0][j - 1] + GAP_PENALTY

    for i in range(1, n + 1):
        target_word = target[i - 1]
        row, previous = score[i], score[i - 1]
        for j in range(1, m + 1):
            sim = similarity(target_word, source[j - 1])
            diagonal = previous[j - 1] + (2.0 * sim - 0.55)
            row[j] = max(diagonal, previous[j] + GAP_PENALTY, row[j - 1] + GAP_PENALTY)

    matches = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        sim = similarity(target[i - 1], source[j - 1])
        if abs(score[i][j] - (score[i - 1][j - 1] + (2.0 * sim - 0.55))) < 1e-9:
            if sim >= MATCH_THRESHOLD:
                matches[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif abs(score[i][j] - (score[i - 1][j] + GAP_PENALTY)) < 1e-9:
            i -= 1
        else:
            j -= 1

    return matches


def assign_times(words, matches, asr_words, duration):
    """Give every pasted word a start/end, interpolating across unmatched runs."""
    times = [None] * len(words)
    for index, match in enumerate(matches):
        if match is not None:
            source = asr_words[match]
            times[index] = [float(source["start"]), float(source["end"])]

    anchors = [i for i, value in enumerate(times) if value is not None]

    if not anchors:
        # Nothing matched at all: spread the words evenly so the sheet still works.
        step = duration / max(1, len(words))
        return [[round(i * step, 3), round((i + 1) * step, 3)] for i in range(len(words))]

    # Words outside the matched region are extrapolated. Reaching toward where
    # singing actually starts and ends beats a flat seconds-per-word guess: when
    # the transcript is too garbled to match a whole verse, that guess would
    # otherwise cram the rest of the song into a couple of seconds.
    asr_start = float(asr_words[0]["start"]) if asr_words else 0.0
    asr_end = float(asr_words[-1]["end"]) if asr_words else duration

    first, last = anchors[0], anchors[-1]

    if first > 0:
        reach = times[first][0] - asr_start
        span = max(0.35 * first, min(reach, 2.5 * first)) if reach > 0 else 0.35 * first
        start = max(0.0, times[first][0] - span)
        step = (times[first][0] - start) / first
        for i in range(first):
            times[i] = [round(start + i * step, 3), round(start + (i + 1) * step, 3)]

    if last < len(words) - 1:
        remaining = len(words) - 1 - last
        reach = asr_end - times[last][1]
        span = max(0.35 * remaining, min(reach, 2.5 * remaining)) if reach > 0 else 0.35 * remaining
        end = min(duration, times[last][1] + span)
        step = (end - times[last][1]) / remaining
        for offset in range(1, remaining + 1):
            base = times[last][1] + (offset - 1) * step
            times[last + offset] = [round(base, 3), round(base + step, 3)]

    # Fill each interior gap by dividing the span between its two anchors.
    for a, b in zip(anchors, anchors[1:]):
        if b - a <= 1:
            continue
        span_start, span_end = times[a][1], times[b][0]
        if span_end <= span_start:
            span_end = span_start + 0.05 * (b - a)
        step = (span_end - span_start) / (b - a - 1)
        for offset in range(1, b - a):
            base = span_start + (offset - 1) * step
            times[a + offset] = [round(base, 3), round(base + step, 3)]

    return times


def build_lines(lyrics_text, asr_words, duration):
    """Turn pasted lyrics into timed lines, keeping the user's own line breaks."""
    raw_lines = [line.strip() for line in lyrics_text.splitlines()]

    flat_words, line_of_word = [], []
    for line_index, line in enumerate(raw_lines):
        for word in line.split():
            flat_words.append(word)
            line_of_word.append(line_index)

    if not flat_words:
        return []

    matches = align_sequences(
        [normalise(w) for w in flat_words],
        [normalise(w["text"]) for w in asr_words],
    )
    times = assign_times(flat_words, matches, asr_words, duration)

    lines = []
    state = {"index": None, "words": []}

    def flush():
        if state["words"]:
            lines.append(
                {
                    "start": state["words"][0]["start"],
                    "end": state["words"][-1]["end"],
                    "text": " ".join(w["text"] for w in state["words"]),
                    "words": state["words"],
                    "chordsBefore": [],
                    "sourceLine": state["index"],
                }
            )

    for i, word in enumerate(flat_words):
        if line_of_word[i] != state["index"]:
            flush()
            state = {"index": line_of_word[i], "words": []}
        state["words"].append(
            {
                "text": word,
                "start": times[i][0],
                "end": times[i][1],
                # A word may hold several chords when a note is held across a change.
                "chords": [],
            }
        )
    flush()

    # A blank line in the pasted text — a jump of more than one source line —
    # is the user telling us where a stanza ends.
    breaks = [
        index > 0 and line["sourceLine"] - lines[index - 1]["sourceLine"] > 1
        for index, line in enumerate(lines)
    ]
    for line, is_break in zip(lines, breaks):
        line["stanzaBreak"] = is_break
        del line["sourceLine"]
    return lines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True, help="JSON file with chords, asrWords, lyrics")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    with open(args.job, encoding="utf-8") as handle:
        job = json.load(handle)

    asr_words = job.get("asrWords") or []
    duration = float(job.get("duration") or 0) or (
        asr_words[-1]["end"] if asr_words else 1.0
    )

    lines = build_lines(job.get("lyrics", ""), asr_words, duration)
    blocks = align.assemble_blocks(job.get("chords") or [], lines)

    matched = sum(len(w["chords"]) for line in lines for w in line["words"])
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(
            {"blocks": blocks, "lineCount": len(lines), "chordsPlaced": matched},
            handle,
            ensure_ascii=False,
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
