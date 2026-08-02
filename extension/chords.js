/**
 * Real-time chord detection, tuned for guitar.
 *
 * Same maths as the offline pipeline minus the neural networks: fold the
 * spectrum into twelve pitch classes, match against chord templates, smooth over
 * time. No AI — this is signal processing, which is why it keeps up with playback.
 *
 * Detecting live means we cannot look ahead the way the offline analysis does, so
 * stability has to come from somewhere else. Four things provide it, and all four
 * are really the same idea: use what we know about how guitar music behaves.
 *
 *   1. Listen where a guitar lives (80–1100 Hz) and ignore cymbals and sibilance.
 *   2. Follow the bass note — a strummed chord almost always has its root lowest.
 *   3. Learn the song's key as it plays and favour chords that belong to it.
 *   4. Hold a chord for a minimum time; real players do not change every 50 ms.
 */

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Guitar songs live on triads and sevenths. Offering dim/sus/maj7 here mostly
// gives the detector new ways to be wrong on a noisy frame.
const QUALITIES = [
  { suffix: "", intervals: [0, 4, 7], weight: 1.0 },
  { suffix: "m", intervals: [0, 3, 7], weight: 1.0 },
  { suffix: "7", intervals: [0, 4, 7, 10], weight: 0.84 },
  { suffix: "m7", intervals: [0, 3, 7, 10], weight: 0.84 },
];

// A guitar's open low E is 82 Hz; above ~1.1 kHz it is mostly harmonics,
// cymbals and vocal sibilance, none of which say anything about the chord.
const MIN_HZ = 80;
const MAX_HZ = 1100;

// Where the root of a strummed chord sits.
const BASS_MIN_HZ = 75;
const BASS_MAX_HZ = 320;

const CHROMA_ALPHA = 0.11;   // how fast the working chroma follows the audio
const BASS_ALPHA = 0.16;
const KEY_ALPHA = 0.004;     // the key emerges over tens of seconds

/**
 * How reluctant the detector is to change chord. Songs differ enough that this
 * is worth exposing: a slow ballad wants "steady", a busy strummed track that
 * changes twice a bar wants "responsive".
 */
const STABILITY = {
  responsive: { minSeconds: 0.35, margin: 0.02, frames: 3 },
  normal: { minSeconds: 0.65, margin: 0.035, frames: 4 },
  steady: { minSeconds: 1.1, margin: 0.055, frames: 6 },
};

const BASS_BONUS = 0.09;
const KEY_BONUS = 0.16;
const FLATNESS_FLOOR = 1.7;      // below this the frame is percussion, not harmony

function buildTemplates() {
  const templates = [];
  for (let root = 0; root < 12; root++) {
    for (const { suffix, intervals, weight } of QUALITIES) {
      const vector = new Float32Array(12);
      for (const interval of intervals) vector[(root + interval) % 12] = 1;
      // Root and fifth define the chord; a weak third should not be able to flip
      // major and minor on its own.
      vector[root] *= 1.35;
      vector[(root + 7) % 12] *= 1.1;

      let norm = 0;
      for (const value of vector) norm += value * value;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < 12; i++) vector[i] /= norm;

      templates.push({ name: PITCH_CLASSES[root] + suffix, vector, weight, root });
    }
  }
  return templates;
}

class ChordDetector {
  constructor(sampleRate, fftSize) {
    this.templates = buildTemplates();

    const bins = fftSize / 2;
    this.binPitch = new Int8Array(bins).fill(-1);
    this.binGain = new Float32Array(bins);
    this.bassPitch = new Int8Array(bins).fill(-1);

    for (let bin = 0; bin < bins; bin++) {
      const freq = (bin * sampleRate) / fftSize;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pitch = ((Math.round(midi) % 12) + 12) % 12;

      if (freq >= MIN_HZ && freq <= MAX_HZ) {
        this.binPitch[bin] = pitch;
        // Lean on the fundamentals, where the chord's identity actually sits.
        this.binGain[bin] = 1 / (1 + freq / 500);
      }
      if (freq >= BASS_MIN_HZ && freq <= BASS_MAX_HZ) this.bassPitch[bin] = pitch;
    }

    this.chroma = new Float32Array(12);
    this.bass = new Float32Array(12);
    this.key = new Float32Array(12);

    this.current = null;
    this.candidate = null;
    this.candidateHits = 0;
    this.changedAt = -Infinity;
    this.silentFrames = 0;
    this.limits = STABILITY.normal;
  }

  setStability(level) {
    this.limits = STABILITY[level] || STABILITY.normal;
  }

  reset() {
    this.chroma.fill(0);
    this.bass.fill(0);
    this.key.fill(0);
    this.current = null;
    this.candidate = null;
    this.candidateHits = 0;
    this.changedAt = -Infinity;
  }

  /**
   * Feed one spectrum frame (dB, from getFloatFrequencyData) and the playback
   * position in seconds. Returns the chord believed to be sounding, or null.
   */
  push(spectrum, now) {
    const frame = new Float32Array(12);
    const bassFrame = new Float32Array(12);
    let total = 0;
    let bassTotal = 0;

    for (let bin = 0; bin < spectrum.length; bin++) {
      const db = spectrum[bin];
      if (db < -95) continue;
      const magnitude = Math.pow(10, db / 20);

      const pitch = this.binPitch[bin];
      if (pitch >= 0) {
        const value = magnitude * this.binGain[bin];
        frame[pitch] += value;
        total += value;
      }
      const bassPitch = this.bassPitch[bin];
      if (bassPitch >= 0) {
        bassFrame[bassPitch] += magnitude;
        bassTotal += magnitude;
      }
    }

    if (total < 1e-7) {
      if (++this.silentFrames > 25) this.current = null;
      return this.current;
    }
    this.silentFrames = 0;

    for (let i = 0; i < 12; i++) frame[i] /= total;

    // A drum hit spreads energy evenly across every pitch class. Such a frame
    // carries no harmonic information, so let it pass rather than pollute the
    // running average.
    let peak = 0;
    for (const value of frame) peak = Math.max(peak, value);
    if (peak * 12 < FLATNESS_FLOOR) return this.current;

    for (let i = 0; i < 12; i++) {
      this.chroma[i] += (frame[i] - this.chroma[i]) * CHROMA_ALPHA;
      this.key[i] += (frame[i] - this.key[i]) * KEY_ALPHA;
    }
    if (bassTotal > 1e-7) {
      for (let i = 0; i < 12; i++) {
        this.bass[i] += (bassFrame[i] / bassTotal - this.bass[i]) * BASS_ALPHA;
      }
    }

    const chromaNorm = norm(this.chroma);
    if (chromaNorm < 1e-9) return this.current;
    const keyNorm = norm(this.key) || 1;

    // Strongest note in the bass register — the likely root.
    let bassRoot = -1;
    let bassPeak = 0;
    for (let i = 0; i < 12; i++) {
      if (this.bass[i] > bassPeak) {
        bassPeak = this.bass[i];
        bassRoot = i;
      }
    }
    // Only trust it when one note clearly dominates down there.
    if (bassPeak < 0.19) bassRoot = -1;

    let best = null;
    let bestScore = -Infinity;
    let currentScore = -Infinity;

    for (const template of this.templates) {
      let dot = 0;
      let keyDot = 0;
      for (let i = 0; i < 12; i++) {
        dot += this.chroma[i] * template.vector[i];
        keyDot += this.key[i] * template.vector[i];
      }

      let score = (dot / chromaNorm) * template.weight;
      // Chords drawn from the notes the song keeps using are far more likely
      // than ones that share a couple of notes by accident.
      score += (keyDot / keyNorm) * KEY_BONUS;
      if (template.root === bassRoot) score += BASS_BONUS;

      if (score > bestScore) {
        bestScore = score;
        best = template.name;
      }
      if (template.name === this.current) currentScore = score;
    }

    if (best === this.current) {
      this.candidate = null;
      this.candidateHits = 0;
      return this.current;
    }

    // Players hold a chord for at least a beat or two. Refusing to change more
    // often than that removes most of the flicker on busy recordings.
    if (this.current && now - this.changedAt < this.limits.minSeconds) {
      return this.current;
    }

    if (this.current && bestScore - currentScore < this.limits.margin) {
      this.candidateHits = 0;
      return this.current;
    }

    if (best === this.candidate) {
      this.candidateHits++;
    } else {
      this.candidate = best;
      this.candidateHits = 1;
    }

    if (this.candidateHits >= (this.current ? this.limits.frames : 2)) {
      this.current = best;
      this.candidate = null;
      this.candidateHits = 0;
      this.changedAt = now;
    }

    return this.current;
  }
}

function norm(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}
