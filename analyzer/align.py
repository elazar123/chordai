"""Merge a chord track and timed lyrics into a printable chord sheet.

The output is a list of blocks. A "line" block is one line of lyrics whose words
each may carry the chord played on them; an "instrumental" block covers stretches
of music with no singing (intros, solos, outros).
"""

MAX_LINE_CHARS = 42
WORD_GAP_SPLIT = 0.9      # a pause this long inside a segment starts a new line
STANZA_GAP = 3.5          # silence this long between lines separates stanzas
MIN_LINE_WORDS = 2        # shorter than this reads as a fragment, not a line
ORPHAN_MERGE_GAP = 1.4    # only fold a fragment into a neighbour this close


def build_sheet(chord_segments, transcription):
    """Chord sheet from an automatic transcription."""
    return assemble_blocks(chord_segments, _build_lines(transcription.get("segments", [])))


def assemble_blocks(chord_segments, lines):
    """Lay timed lyric lines and a chord track out as sheet blocks.

    Shared by the automatic pipeline and by the re-sync path that takes the real
    lyrics pasted in by the user.
    """
    chords = [c for c in chord_segments if c["chord"] != "N"]

    if not lines:
        # Instrumental track (or transcription found nothing): present the whole
        # thing as chord rows so the sheet is still useful.
        return _instrumental_blocks(chords) if chords else []

    blocks = []
    used = 0

    for index, line in enumerate(lines):
        # Chords that sound before this line starts belong to the gap ahead of it.
        boundary = line["start"]
        gap_chords = []
        while used < len(chords) and chords[used]["start"] < boundary - 0.15:
            gap_chords.append(chords[used])
            used += 1

        if gap_chords:
            previous_end = lines[index - 1]["end"] if index else 0.0
            # Only call it an instrumental break if there was a real musical pause;
            # otherwise these are just chords that led into the line.
            if line["start"] - previous_end >= STANZA_GAP or index == 0:
                blocks.append(
                    {
                        "type": "instrumental",
                        "start": round(gap_chords[0]["start"], 3),
                        "end": round(gap_chords[-1]["end"], 3),
                        "chords": gap_chords,
                    }
                )
            else:
                line["chordsBefore"] = gap_chords

        line_chords = []
        while used < len(chords) and chords[used]["start"] < line["end"] - 0.05:
            line_chords.append(chords[used])
            used += 1

        _attach_chords_to_words(line, line_chords)
        line["chords"] = line["chordsBefore"] + line_chords
        line["type"] = "line"
        # A break the caller already marked (a blank line in pasted lyrics) is the
        # user's explicit intent and outranks anything the timing suggests.
        line["stanzaBreak"] = bool(line.get("stanzaBreak")) or (
            index > 0 and line["start"] - lines[index - 1]["end"] >= STANZA_GAP
        )
        blocks.append(line)

    if used < len(chords):
        tail = chords[used:]
        blocks.append(
            {
                "type": "instrumental",
                "start": round(tail[0]["start"], 3),
                "end": round(tail[-1]["end"], 3),
                "chords": tail,
            }
        )

    return blocks


def _build_lines(segments):
    """Split Whisper segments into short, singable lines."""
    lines = []
    for segment in segments:
        words = segment.get("words") or []
        if not words:
            continue

        current = []
        for word in words:
            if current:
                gap = word["start"] - current[-1]["end"]
                length = sum(len(w["text"]) + 1 for w in current)
                if gap >= WORD_GAP_SPLIT or length >= MAX_LINE_CHARS:
                    lines.append(_make_line(current))
                    current = []
            current.append(word)
        if current:
            lines.append(_make_line(current))
    return _merge_orphan_lines(lines)


def _join_lines(first, second):
    return _make_line(
        [
            {"start": w["start"], "end": w["end"], "text": w["text"]}
            for w in first["words"] + second["words"]
        ]
    )


def _merge_orphan_lines(lines):
    """Fold one-word fragments back into whichever neighbour they belong to.

    Singers pause mid-phrase, which splits a phrase like "אני / שר לך שיר" in two.
    The fragment goes to the neighbour it is closest to in time, since that is
    almost always the phrase it was actually part of.
    """
    if len(lines) < 2:
        return lines

    pending = list(lines)
    result = []
    index = 0

    while index < len(pending):
        line = pending[index]
        if len(line["words"]) >= MIN_LINE_WORDS:
            result.append(line)
            index += 1
            continue

        previous = result[-1] if result else None
        following = pending[index + 1] if index + 1 < len(pending) else None

        gap_previous = line["start"] - previous["end"] if previous else float("inf")
        gap_following = following["start"] - line["end"] if following else float("inf")

        fits_previous = previous is not None and (
            gap_previous <= ORPHAN_MERGE_GAP
            and len(previous["text"]) + len(line["text"]) + 1 <= MAX_LINE_CHARS
        )
        fits_following = following is not None and (
            gap_following <= ORPHAN_MERGE_GAP
            and len(following["text"]) + len(line["text"]) + 1 <= MAX_LINE_CHARS
        )

        if fits_previous and (not fits_following or gap_previous <= gap_following):
            result[-1] = _join_lines(previous, line)
        elif fits_following:
            pending[index + 1] = _join_lines(line, following)
        else:
            result.append(line)
        index += 1

    return result


def _make_line(words):
    return {
        "start": round(words[0]["start"], 3),
        "end": round(words[-1]["end"], 3),
        "text": " ".join(w["text"] for w in words),
        # A word can carry more than one chord: held notes and melismas often span
        # a chord change, and dropping the second one would lose real information.
        "words": [dict(w, chords=[]) for w in words],
        "chordsBefore": [],
    }


def _attach_chords_to_words(line, chords):
    """Pin each chord to the word being sung when it starts."""
    words = line["words"]
    if not words:
        return

    for chord in chords:
        best_index, best_distance = 0, float("inf")
        for i, word in enumerate(words):
            if word["start"] <= chord["start"] <= word["end"]:
                best_index, best_distance = i, 0.0
                break
            distance = min(
                abs(word["start"] - chord["start"]), abs(word["end"] - chord["start"])
            )
            if distance < best_distance:
                best_index, best_distance = i, distance

        # Prefer the next word that has no chord yet so a run of chords spreads out
        # instead of piling onto one word, but never drop a chord entirely.
        index = best_index
        while index < len(words) and words[index]["chords"]:
            index += 1
        if index >= len(words):
            index = best_index

        # Each chord keeps its own timing so the player can highlight the exact
        # occurrence, even when a line repeats the same chord twice.
        words[index]["chords"].append(
            {
                "chord": chord["chord"],
                "start": chord["start"],
                "end": chord["end"],
            }
        )


def _instrumental_blocks(chords, per_row=8):
    blocks = []
    for i in range(0, len(chords), per_row):
        row = chords[i : i + per_row]
        blocks.append(
            {
                "type": "instrumental",
                "start": round(row[0]["start"], 3),
                "end": round(row[-1]["end"], 3),
                "chords": row,
            }
        )
    return blocks
