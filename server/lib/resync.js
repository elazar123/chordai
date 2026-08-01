import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { run } from "./media.js";

/**
 * Words the alignment runs against.
 * Prefer the stored transcription; songs analysed before that field existed fall
 * back to the word timings already embedded in their blocks.
 */
function sourceWords(song) {
  if (song.asrWords?.length) return song.asrWords;
  const words = [];
  for (const block of song.blocks || []) {
    if (block.type !== "line") continue;
    for (const word of block.words || []) {
      words.push({ text: word.text, start: word.start, end: word.end });
    }
  }
  return words;
}

/**
 * Re-lay a song's sheet using the real lyrics the user pasted, keeping their
 * words and line breaks and borrowing timing from the transcription.
 */
export async function resyncLyrics(song, lyrics) {
  const words = sourceWords(song);
  if (!words.length) {
    throw new Error("אין תזמון מילים לשיר הזה — צריך לנתח אותו מחדש עם מילים");
  }

  const cacheDir = path.join(config.dataDir, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const token = randomUUID();
  const jobFile = path.join(cacheDir, `resync-${token}.json`);
  const outFile = path.join(cacheDir, `resync-${token}.out.json`);

  fs.writeFileSync(
    jobFile,
    JSON.stringify({
      chords: song.chords || [],
      asrWords: words,
      lyrics,
      duration: song.duration,
    }),
    "utf8"
  );

  try {
    await run(
      config.python,
      [path.join(config.analyzerDir, "resync.py"), "--job", jobFile, "--out", outFile],
      { timeoutMs: 120_000 }
    );
    return JSON.parse(fs.readFileSync(outFile, "utf8"));
  } finally {
    fs.rmSync(jobFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}
