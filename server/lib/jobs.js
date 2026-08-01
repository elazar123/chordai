import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { run, downloadYouTubeAudio, convertToMp3, fetchYouTubeMetadata } from "./media.js";
import { saveSong } from "./store.js";

const jobs = new Map();
const queue = [];
let running = false;

export const jobEvents = new EventEmitter();
// Each job gets its own SSE listeners; the default cap of 10 is easy to exceed
// with a few browser tabs open.
jobEvents.setMaxListeners(0);

export function createJob(kind, payload) {
  const job = {
    id: randomUUID(),
    kind,
    payload,
    status: "queued",
    pct: 0,
    message: "ממתין בתור",
    songId: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  drain();
  return job;
}

export function getJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  const { payload, ...safe } = job;
  return safe;
}

function update(job, patch) {
  Object.assign(job, patch);
  const { payload, ...safe } = job;
  jobEvents.emit(job.id, safe);
}

async function drain() {
  if (running) return;
  const next = queue.shift();
  if (!next) return;

  const job = jobs.get(next);
  if (!job) return drain();

  running = true;
  try {
    update(job, { status: "running", pct: 1, message: "מתחיל" });
    const song = await process(job);
    update(job, {
      status: "done",
      pct: 100,
      message: "מוכן",
      songId: song.id,
    });
  } catch (error) {
    update(job, {
      status: "error",
      message: "העיבוד נכשל",
      error: error?.message || String(error),
    });
  } finally {
    running = false;
    // Let the event loop turn over before picking up the next job.
    setImmediate(drain);
  }
}

async function process(job) {
  const songId = randomUUID();
  let audioPath;
  let meta = {};

  if (job.kind === "youtube") {
    update(job, { pct: 3, message: "קורא פרטי סרטון" });
    meta = await fetchYouTubeMetadata(job.payload.url);

    update(job, { pct: 6, message: "מוריד אודיו מיוטיוב" });
    audioPath = await downloadYouTubeAudio(job.payload.url, songId, (pct) => {
      update(job, { pct: 6 + pct * 0.19, message: `מוריד אודיו — ${Math.round(pct)}%` });
    });
  } else {
    update(job, { pct: 8, message: "ממיר את ההקלטה" });
    audioPath = await convertToMp3(job.payload.tempPath, songId);
    fs.rmSync(job.payload.tempPath, { force: true });
    meta = { title: job.payload.title || "הקלטה חדשה" };
  }

  update(job, { pct: 25, message: "מנתח אקורדים" });
  const sheet = await runAnalyzer(job, songId, audioPath);

  const song = saveSong({
    id: songId,
    title: meta.title || "שיר ללא שם",
    artist: meta.artist || null,
    thumbnail: meta.thumbnail || null,
    source:
      job.kind === "youtube"
        ? { type: "youtube", url: job.payload.url, videoId: job.payload.videoId }
        : { type: job.payload.origin || "upload" },
    audioFile: path.basename(audioPath),
    audioUrl: `/audio/${path.basename(audioPath)}`,
    // Lets an identical re-upload be recognised and served from the library.
    audioHash: job.payload.audioHash || null,
    duration: sheet.duration,
    bpm: sheet.bpm,
    key: sheet.key,
    language: sheet.language,
    hasLyrics: sheet.hasLyrics,
    chords: sheet.chords,
    blocks: sheet.blocks,
    asrWords: sheet.asrWords || [],
    createdAt: new Date().toISOString(),
  });

  return song;
}

function runAnalyzer(job, songId, audioPath) {
  const outFile = path.join(config.dataDir, "cache", `${songId}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const language = job.payload.language || config.defaultLanguage;
  const args = [
    path.join(config.analyzerDir, "analyze.py"),
    "--audio", audioPath,
    "--out", outFile,
    "--whisper-model", job.payload.model || config.whisperModel,
  ];
  if (language && language !== "auto") args.push("--language", language);
  if (job.payload.skipLyrics) args.push("--skip-lyrics");

  const separate = job.payload.separate ?? config.separateVocals;
  if (separate) args.push("--separate", "--device", config.separationDevice);

  let failure = null;

  return run(config.python, args, {
    timeoutMs: 60 * 60_000,
    onStdoutLine: (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return; // Ignore stray non-JSON output from the libraries.
      }
      if (event.type === "progress") {
        // The analyzer's own 0-100 maps onto the 25-99 slice of the job.
        update(job, {
          pct: 25 + event.pct * 0.74,
          message: event.message,
        });
      } else if (event.type === "error") {
        failure = event;
      }
    },
  }).then(() => {
    if (failure) throw new Error(failure.message);
    const sheet = JSON.parse(fs.readFileSync(outFile, "utf8"));
    fs.rmSync(outFile, { force: true });
    return sheet;
  }, (error) => {
    throw new Error(failure?.message || error.message);
  });
}
