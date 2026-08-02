const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const NOTE_INDEX = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10,
  B: 11, Cb: 11, "B#": 0,
};

const CHORD_PATTERN = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/;

export function parseChord(name) {
  if (!name || name === "N") return null;
  const match = String(name).trim().match(CHORD_PATTERN);
  if (!match) return null;
  return { root: match[1], suffix: match[2] || "", bass: match[3] || null };
}

/** Shift a chord name by a number of semitones. Returns the original on failure. */
export function transposeChord(name, semitones, preferFlats = false) {
  const parsed = parseChord(name);
  if (!parsed) return name;
  if (!semitones) return name;

  const scale = preferFlats ? FLAT : SHARP;
  const shift = (index) => scale[(((index + semitones) % 12) + 12) % 12];

  const rootIndex = NOTE_INDEX[parsed.root];
  if (rootIndex === undefined) return name;

  let result = shift(rootIndex) + parsed.suffix;
  if (parsed.bass) {
    const bassIndex = NOTE_INDEX[parsed.bass];
    if (bassIndex !== undefined) result += "/" + shift(bassIndex);
  }
  return result;
}

/**
 * Reduce a chord to the triad most players will actually strum.
 * The detector is happy to report Cmaj7 / Esus4 / G6 from a single passing note,
 * which clutters a sheet that someone is trying to read while playing.
 * Minor and diminished survive — they change the chord's identity; sevenths,
 * sixths and suspensions do not.
 */
export function simplifyChord(name) {
  const parsed = parseChord(name);
  if (!parsed) return name;

  const { root, suffix } = parsed;
  if (suffix.startsWith("dim")) return root + "dim";
  // "m", "m7", "m6", "m9" — but not "maj7".
  if (suffix.startsWith("m") && !suffix.startsWith("maj")) return root + "m";
  return root;
}

/**
 * Chords the player actually fingers.
 * `transpose` moves the sounding key; `capo` raises the strings, so the shapes
 * drop by the capo position.
 */
export function displayChord(
  name,
  { transpose = 0, capo = 0, preferFlats = false, simplify = false } = {}
) {
  const shifted = transposeChord(name, transpose - capo, preferFlats);
  return simplify ? simplifyChord(shifted) : shifted;
}

export function transposeKey(key, semitones, preferFlats = false) {
  if (!key) return key;
  const [root, quality] = key.split(" ");
  const shifted = transposeChord(root, semitones, preferFlats);
  return quality ? `${shifted} ${quality}` : shifted;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  return `${mins}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Convert a chord the user typed (which they read in the transposed view) back
 * into the sounding chord we store.
 */
export function toStoredChord(displayed, { transpose = 0, capo = 0 } = {}) {
  return transposeChord(displayed, -(transpose - capo));
}

/** Unique chords in playing order — used for the "chords used" summary. */
export function uniqueChords(blocks, options) {
  const seen = new Set();
  const list = [];

  const add = (raw) => {
    const name = displayChord(raw, options);
    if (name && name !== "N" && !seen.has(name)) {
      seen.add(name);
      list.push(name);
    }
  };

  // Read from where the chords actually live, so hand-edits are reflected too.
  for (const block of blocks || []) {
    if (block.type === "instrumental") {
      for (const chord of block.chords || []) add(chord.chord);
      continue;
    }
    for (const chord of block.chordsBefore || []) add(chord.chord);
    for (const word of block.words || []) {
      for (const chord of word.chords || []) add(chord.chord);
    }
  }
  return list;
}
