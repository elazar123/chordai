import { parseChord } from "./music.js";

const NOTE_INDEX = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10,
  B: 11, Cb: 11, "B#": 0,
};

// Semitones above the root for each chord quality we can produce.
const QUALITY_INTERVALS = [
  ["maj7", [0, 4, 7, 11]],
  ["m7", [0, 3, 7, 10]],
  ["m6", [0, 3, 7, 9]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["sus4", [0, 5, 7]],
  ["sus2", [0, 2, 7]],
  ["m", [0, 3, 7]],
  ["7", [0, 4, 7, 10]],
  ["6", [0, 4, 7, 9]],
  ["", [0, 4, 7]],
];

export const INSTRUMENTS = {
  guitar: {
    id: "guitar",
    label: "גיטרה",
    // Open-string pitches, lowest string first.
    tuning: ["E", "A", "D", "G", "B", "E"],
    minSounding: 4,
    fretted: true,
  },
  ukulele: {
    id: "ukulele",
    label: "יוקללה",
    tuning: ["G", "C", "E", "A"],
    minSounding: 4,
    fretted: true,
  },
  piano: {
    id: "piano",
    label: "פסנתר",
    fretted: false,
  },
};

function chordTones(name) {
  const parsed = parseChord(name);
  if (!parsed) return null;
  const root = NOTE_INDEX[parsed.root];
  if (root === undefined) return null;

  const entry =
    QUALITY_INTERVALS.find(([suffix]) => suffix && parsed.suffix.startsWith(suffix)) ||
    QUALITY_INTERVALS[QUALITY_INTERVALS.length - 1];

  return {
    root,
    pitches: entry[1].map((step) => (root + step) % 12),
  };
}

/** Pitch classes of a chord — what the piano diagram highlights. */
export function chordPitchClasses(name) {
  return chordTones(name)?.pitches ?? null;
}

/**
 * Find a playable fingering by searching the fretboard for the chord's notes.
 *
 * Computing this beats shipping a lookup table: it is guaranteed to produce the
 * right notes for any chord the detector emits, including the odd ones, instead
 * of silently missing an entry.
 *
 * Returns { frets: number[]|null[], baseFret } where null means a muted string
 * and 0 means open.
 */
export function chordShape(name, instrumentId = "guitar", { maxFret = 12 } = {}) {
  const instrument = INSTRUMENTS[instrumentId];
  if (!instrument?.fretted) return null;

  const tones = chordTones(name);
  if (!tones) return null;

  const openPitches = instrument.tuning.map((note) => NOTE_INDEX[note]);
  const toneSet = new Set(tones.pitches);

  // Per string: every fret within reach that lands on a chord tone, plus muting.
  const options = openPitches.map((open) => {
    const list = [];
    for (let fret = 0; fret <= maxFret; fret++) {
      if (toneSet.has((open + fret) % 12)) list.push(fret);
    }
    list.push(null);
    return list;
  });

  let best = null;

  const walk = (stringIndex, chosen) => {
    if (stringIndex === options.length) {
      const score = scoreVoicing(chosen, openPitches, tones, instrument);
      if (score !== null && (!best || score < best.score)) {
        best = { score, frets: [...chosen] };
      }
      return;
    }
    for (const fret of options[stringIndex]) {
      chosen.push(fret);
      if (spanOk(chosen)) walk(stringIndex + 1, chosen);
      chosen.pop();
    }
  };

  walk(0, []);
  if (!best) return null;

  const fretted = best.frets.filter((f) => f !== null && f > 0);
  const baseFret = fretted.length && Math.min(...fretted) > 4 ? Math.min(...fretted) : 1;
  return { frets: best.frets, baseFret };
}

/** Fingers only stretch so far: reject anything wider than four frets. */
function spanOk(frets) {
  const played = frets.filter((f) => f !== null && f > 0);
  if (played.length < 2) return true;
  return Math.max(...played) - Math.min(...played) <= 4;
}

/** Lower is better; null rejects the voicing outright. */
function scoreVoicing(frets, openPitches, tones, instrument) {
  const sounding = [];
  frets.forEach((fret, index) => {
    if (fret !== null) sounding.push({ index, pitch: (openPitches[index] + fret) % 12 });
  });

  if (sounding.length < instrument.minSounding) return null;

  // Every note of the chord must be present, or it is a different chord.
  const present = new Set(sounding.map((note) => note.pitch));
  for (const pitch of tones.pitches) if (!present.has(pitch)) return null;

  // Muted strings are only acceptable at the bass end, never in the middle.
  const firstPlayed = frets.findIndex((f) => f !== null);
  for (let i = firstPlayed; i < frets.length; i++) {
    if (frets[i] === null) return null;
  }

  const fretted = frets.filter((f) => f !== null && f > 0);
  const highest = fretted.length ? Math.max(...fretted) : 0;
  const span = fretted.length ? highest - Math.min(...fretted) : 0;

  // A hand has four usable fingers. Without this the search happily returns
  // note-correct shapes nobody can actually hold.
  const fingers = fingersNeeded(frets);
  if (fingers > 4) return null;

  let score = highest * 1.9 + span * 1.5 + fingers * 1.1;
  // The root belongs in the bass: an inversion is a different-sounding chord,
  // and this outweighs saving a fret or a finger.
  if (sounding[0].pitch !== tones.root) score += 7.0;
  score += (frets.length - sounding.length) * 1.4;
  return score;
}

/**
 * Fingers a shape costs, accounting for a barre.
 * A barre is only possible when no string in the shape rings open — one finger
 * lies across the lowest fret, and the rest handle anything above it.
 */
function fingersNeeded(frets) {
  const played = frets.filter((f) => f !== null);
  const fretted = played.filter((f) => f > 0);
  if (!fretted.length) return 0;

  const hasOpen = played.some((f) => f === 0);
  if (hasOpen) return fretted.length;

  const lowest = Math.min(...fretted);
  const barred = fretted.filter((f) => f === lowest).length;
  // Barring only pays off when it covers more than one string.
  if (barred < 2) return fretted.length;
  return 1 + fretted.filter((f) => f > lowest).length;
}
