/**
 * Collapse repeated chord progressions.
 *
 * A repetitive song leaves instrumental stretches that print as dozens of chord
 * boxes — a whole wasted page for what a musician reads as "that four-chord loop,
 * eight times". This finds the shortest loop that tiles a run and reports it once
 * with a repeat count.
 */

const MAX_PATTERN = 8;   // longest loop worth looking for, in chords
const MIN_REPEATS = 2;   // fewer than this is not a pattern, just chords

/**
 * Split a chord list into groups: either a repeated pattern or a plain run.
 * Returns [{ chords, times }] where `times` is 1 for anything not repeating.
 */
export function collapseRepeats(chords, { minRepeats = MIN_REPEATS } = {}) {
  if (!chords?.length) return [];

  const names = chords.map((chord) => chord.chord);
  const groups = [];
  let index = 0;

  while (index < names.length) {
    let best = null;

    // Prefer the shortest pattern: a 2-chord loop repeated 8 times reads better
    // than a 4-chord loop repeated 4 times when both describe the same run.
    for (let size = 1; size <= MAX_PATTERN; size++) {
      if (index + size * minRepeats > names.length) break;

      let repeats = 1;
      while (
        index + size * (repeats + 1) <= names.length &&
        matches(names, index, index + size * repeats, size)
      ) {
        repeats++;
      }

      if (repeats >= minRepeats) {
        best = { size, repeats };
        break;
      }
    }

    if (best) {
      const { size, repeats } = best;
      groups.push({
        chords: chords.slice(index, index + size),
        times: repeats,
        start: chords[index].start,
        end: chords[index + size * repeats - 1].end,
      });
      index += size * repeats;
    } else {
      // Accumulate non-repeating chords until the next pattern begins.
      const run = [];
      while (index < names.length) {
        const ahead = findPatternAt(names, index, minRepeats);
        if (ahead && run.length) break;
        run.push(chords[index]);
        index++;
        if (ahead) break;
      }
      if (run.length) {
        groups.push({
          chords: run,
          times: 1,
          start: run[0].start,
          end: run[run.length - 1].end,
        });
      }
    }
  }

  return groups;
}

function matches(names, aStart, bStart, size) {
  for (let i = 0; i < size; i++) {
    if (names[aStart + i] !== names[bStart + i]) return false;
  }
  return true;
}

/** Does a repeating pattern start exactly at `index`? */
function findPatternAt(names, index, minRepeats) {
  for (let size = 1; size <= MAX_PATTERN; size++) {
    if (index + size * minRepeats > names.length) break;
    let ok = true;
    for (let r = 1; r < minRepeats; r++) {
      if (!matches(names, index, index + size * r, size)) {
        ok = false;
        break;
      }
    }
    if (ok) return size;
  }
  return null;
}
