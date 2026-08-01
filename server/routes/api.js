import express from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import { config } from "../config.js";
import { createJob, getJob, jobEvents } from "../lib/jobs.js";
import { parseYouTubeUrl, hashFile } from "../lib/media.js";
import { resyncLyrics } from "../lib/resync.js";
import {
  listSongs,
  getSong,
  saveSong,
  deleteSong,
  isValidId,
  findByVideoId,
  findByAudioHash,
} from "../lib/store.js";

export const api = express.Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: config.maxUploadBytes },
});

api.get("/health", (_req, res) => {
  res.json({ ok: true, whisperModel: config.whisperModel, language: config.defaultLanguage });
});

api.post("/analyze/youtube", (req, res) => {
  const parsed = parseYouTubeUrl(req.body?.url);
  if (!parsed) {
    return res.status(400).json({ error: "הקישור אינו קישור יוטיוב תקין" });
  }

  // Already analysed this video? Hand back the stored sheet instead of spending
  // minutes downloading and re-analysing identical audio.
  if (!req.body?.force) {
    const existing = findByVideoId(parsed.videoId);
    if (existing) return res.json({ songId: existing.id, cached: true });
  }

  const job = createJob("youtube", {
    url: parsed.url,
    videoId: parsed.videoId,
    language: req.body?.language,
    model: req.body?.model,
    skipLyrics: Boolean(req.body?.skipLyrics),
  });
  res.status(202).json({ jobId: job.id });
});

api.post("/analyze/upload", upload.single("audio"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "לא התקבל קובץ שמע" });

  let audioHash = null;
  try {
    audioHash = await hashFile(req.file.path);
  } catch {
    // Hashing is only an optimisation — fall through and analyse normally.
  }

  // The identical file uploaded again returns the sheet we already produced.
  if (!req.body?.force && audioHash) {
    const existing = findByAudioHash(audioHash);
    if (existing) {
      fs.rm(req.file.path, { force: true }, () => {});
      return res.json({ songId: existing.id, cached: true });
    }
  }

  const job = createJob("upload", {
    tempPath: req.file.path,
    audioHash,
    title: req.body?.title || req.file.originalname?.replace(/\.[^.]+$/, ""),
    origin: req.body?.origin === "recording" ? "recording" : "upload",
    language: req.body?.language,
    model: req.body?.model,
    skipLyrics: req.body?.skipLyrics === "true",
  });
  res.status(202).json({ jobId: job.id });
});

api.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "המשימה לא נמצאה" });
  res.json(job);
});

/** Server-sent events stream so the browser sees progress without polling. */
api.get("/jobs/:id/events", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "המשימה לא נמצאה" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send(job);

  const listener = (payload) => {
    send(payload);
    if (payload.status === "done" || payload.status === "error") res.end();
  };
  jobEvents.on(req.params.id, listener);

  // Proxies drop idle connections; a comment line every 20s keeps it warm.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    jobEvents.off(req.params.id, listener);
  });
});

api.get("/songs", (_req, res) => {
  res.json(listSongs());
});

api.get("/songs/:id", (req, res) => {
  const song = getSong(req.params.id);
  if (!song) return res.status(404).json({ error: "השיר לא נמצא" });
  res.json(song);
});

api.patch("/songs/:id", (req, res) => {
  const song = getSong(req.params.id);
  if (!song) return res.status(404).json({ error: "השיר לא נמצא" });

  // Only fields a user can legitimately correct by hand.
  const editable = ["title", "artist", "key", "bpm", "blocks", "chords", "capo", "transpose"];
  for (const field of editable) {
    if (field in (req.body || {})) song[field] = req.body[field];
  }
  res.json(saveSong(song));
});

/** Replace the sheet's lyrics with the real ones, re-synced to the audio. */
api.post("/songs/:id/lyrics", async (req, res, next) => {
  const song = getSong(req.params.id);
  if (!song) return res.status(404).json({ error: "השיר לא נמצא" });

  const lyrics = String(req.body?.lyrics || "").trim();
  if (!lyrics) return res.status(400).json({ error: "לא התקבלו מילים" });

  try {
    const result = await resyncLyrics(song, lyrics);
    song.blocks = result.blocks;
    song.hasLyrics = result.blocks.some((block) => block.type === "line");
    song.lyricsSource = "manual";
    res.json(saveSong(song));
  } catch (error) {
    next(error);
  }
});

api.delete("/songs/:id", (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: "מזהה לא תקין" });
  if (!deleteSong(req.params.id)) return res.status(404).json({ error: "השיר לא נמצא" });
  res.json({ ok: true });
});
