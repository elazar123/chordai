/**
 * Real-time chord detection from an FFT spectrum.
 *
 * Same idea as the offline pipeline, minus the neural networks: fold the
 * spectrum into the twelve pitch classes, match that against chord templates,
 * and smooth the result over time. No AI involved — this is signal processing,
 * which is why it can keep up with playback inside a browser tab.
 *
 * Detecting live means we cannot look ahead the way the offline version does, so
 * stability comes from smoothing instead: the chroma is averaged over time and a
 * new chord has to stay ahead of the current one before it is allowed to take over.
 */

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const QUALITIES = [
  { suffix: "", intervals: [0, 4, 7], weight: 1.0 },
  { suffix: "m", intervals: [0, 3, 7], weight: 1.0 },
  { suffix: "7", intervals: [0, 4, 7, 10], weight: 0.9 },
  { suffix: "m7", intervals: [0, 3, 7, 10], weight: 0.9 },
  { suffix: "maj7", intervals: [0, 4, 7, 11], weight: 0.87 },
  { suffix: "sus4", intervals: [0, 5, 7], weight: 0.84 },
  { suffix: "dim", intervals: [0, 3, 6], weight: 0.8 },
];

// Only the range where chords actually live. Below this is bass rumble and
// above it the harmonics of other notes drown out the real pitches.
const MIN_HZ = 75;
const MAX_HZ = 1800;

function buildTemplates() {
  const templates = [];
  for (let root = 0; root < 12; root++) {
    for (const { suffix, intervals, weight } of QUALITIES) {
      const vector = new Float32Array(12);
      for (const interval of intervals) vector[(root + interval) % 12] = 1;
      // The root and fifth define the chord; a weak third should not be able to
      // flip major and minor on its own.
      vector[root] *= 1.35;
      vector[(root + 7) % 12] *= 1.1;

      let norm = 0;
      for (const value of vector) norm += value * value;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < 12; i++) vector[i] /= norm;

      templates.push({ name: PITCH_CLASSES[root] + suffix, vector, weight });
    }
  }
  return templates;
}

// Content scripts are classic scripts, not modules: files listed together in the
// manifest share one isolated global scope, so this is how content.js sees it.
class ChordDetector {
  constructor(sampleRate, fftSize) {
    this.templates = buildTemplates();
    this.binPitch = new Int8Array(fftSize / 2);
    this.binGain = new Float32Array(fftSize / 2);

    // Precompute which pitch class each FFT bin belongs to.
    for (let bin = 0; bin < fftSize / 2; bin++) {
      const freq = (bin * sampleRate) / fftSize;
      if (freq < MIN_HZ || freq > MAX_HZ) {
        this.binPitch[bin] = -1;
        continue;
      }
      const midi = 69 + 12 * Math.log2(freq / 440);
      this.binPitch[bin] = ((Math.round(midi) % 12) + 12) % 12;
      // Higher partials are mostly harmonics of lower notes, so lean on the
      // fundamentals where the chord's identity really sits.
      this.binGain[bin] = 1 / (1 + freq / 700);
    }

    this.chroma = new Float32Array(12);
    this.current = null;
    this.candidate = null;
    this.candidateHits = 0;
  }

  /**
   * Feed one spectrum frame (dB values from getFloatFrequencyData).
   * Returns the chord name currently believed to be sounding, or null.
   */
  push(spectrum) {
    const frame = new Float32Array(12);
    let total = 0;

    for (let bin = 0; bin < spectrum.length; bin++) {
      const pitch = this.binPitch[bin];
      if (pitch < 0) continue;
      // getFloatFrequencyData is in dB; -100 is effectively silence.
      const magnitude = Math.pow(10, spectrum[bin] / 20);
      const value = magnitude * this.binGain[bin];
      frame[pitch] += value;
      total += value;
    }

    if (total < 1e-6) {
      this.silentFrames = (this.silentFrames || 0) + 1;
      if (this.silentFrames > 8) this.current = null;
      return this.current;
    }
    this.silentFrames = 0;

    for (let i = 0; i < 12; i++) frame[i] /= total;

    // Exponential moving average: one noisy frame should not change the chord.
    const alpha = 0.28;
    for (let i = 0; i < 12; i++) {
      this.chroma[i] = this.chroma[i] * (1 - alpha) + frame[i] * alpha;
    }

    let norm = 0;
    for (const value of this.chroma) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm < 1e-9) return this.current;

    let best = null;
    let bestScore = -Infinity;
    let currentScore = -Infinity;

    for (const template of this.templates) {
      let dot = 0;
      for (let i = 0; i < 12; i++) dot += this.chroma[i] * template.vector[i];
      const score = (dot / norm) * template.weight;
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

    // A challenger must be clearly better, and stay better, before it takes over.
    const margin = this.current ? bestScore - currentScore : Infinity;
    if (margin < 0.012) {
      this.candidateHits = 0;
      return this.current;
    }

    if (best === this.candidate) this.candidateHits++;
    else {
      this.candidate = best;
      this.candidateHits = 1;
    }

    if (this.candidateHits >= (this.current ? 3 : 2)) {
      this.current = best;
      this.candidate = null;
      this.candidateHits = 0;
    }

    return this.current;
  }
}
