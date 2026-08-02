import express from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import { config } from "../config.js";
import { createJob, getJob, jobEvents } from "../lib/jobs.js";
import { parseYouTubeUrl, hashFile } from "../lib/media.js";
import { resyncLyrics } from "../lib/resync.js";
import {
  authEnabled,
  verifyGoogleToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  ownsSong,
} from "../lib/auth.js";
import {
  listSongs,
  getSong,
  saveSong,
  deleteSong,
  isValidId,
  findByVideoId,
  findByAudioHash,
  claimOrphanSongs,
} from "../lib/store.js";

export const api = express.Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: config.maxUploadBytes },
});

api.get("/health", (_req, res) => {
  res.json({ ok: true, whisperModel: config.whisperModel, language: config.defaultLanguage });
});

/** What the browser needs before rendering: is sign-in on, and who is signed in. */
api.get("/auth/session", (req, res) => {
  res.json({
    authEnabled: authEnabled(),
    clientId: config.googleClientId || null,
    user: req.user?.local ? null : req.user,
  });
});

api.post("/auth/google", async (req, res) => {
  if (!authEnabled()) return res.status(400).json({ error: "התחברות אינה מופעלת" });
  try {
    const user = await verifyGoogleToken(req.body?.credential);
    setSessionCookie(res, user);
    // One-time migration: songs made before sign-in existed belong to whoever
    // signs in first on this install.
    claimOrphanSongs(user.id);
    res.json({ user });
  } catch (error) {
    // Our own checks (unverified email, address not on the allow-list) carry a
    // message worth showing; anything from the Google library is internal noise.
    const ours = error.expose === true;
    res.status(401).json({ error: ours ? error.message : "ההתחברות נכשלה" });
  }
});

api.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Everything past this point is per-user data.
api.use(requireAuth);

api.post("/analyze/youtube", (req, res) => {
  const parsed = parseYouTubeUrl(req.body?.url);
  if (!parsed) {
    return res.status(400).json({ error: "הקישור אינו קישור יוטיוב תקין" });
  }

  // Already analysed this video? Hand back the stored sheet instead of spending
  // minutes downloading and re-analysing identical audio.
  if (!req.body?.force) {
    const existing = findByVideoId(parsed.videoId, req.user?.id);
    if (existing) return res.json({ songId: existing.id, cached: true });
  }

  const job = createJob("youtube", {
    url: parsed.url,
    videoId: parsed.videoId,
    owner: req.user?.id || null,
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
    const existing = findByAudioHash(audioHash, req.user?.id);
    if (existing) {
      fs.rm(req.file.path, { force: true }, () => {});
      return res.json({ songId: existing.id, cached: true });
    }
  }

  const job = createJob("upload", {
    tempPath: req.file.path,
    audioHash,
    owner: req.user?.id || null,
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

api.get("/songs", (req, res) => {
  res.json(listSongs(req.user?.id));
});

/**
 * Look a song up by its YouTube id.
 * The browser extension only knows which video is playing, so this is how it
 * asks whether we already have chords for it. Declared before "/songs/:id" so
 * that route does not swallow the path.
 */
api.get("/songs/by-video/:videoId", (req, res) => {
  const song = findByVideoId(req.params.videoId);
  if (!song || !ownsSong(req.user, song)) {
    return res.status(404).json({ error: "השיר עדיין לא נותח" });
  }
  res.json(song);
});

api.get("/songs/:id", (req, res) => {
  const song = getSong(req.params.id);
  // A song belonging to someone else is reported as missing, not as forbidden:
  // there is no reason to confirm that an id exists.
  if (!song || !ownsSong(req.user, song)) {
    return res.status(404).json({ error: "השיר לא נמצא" });
  }
  res.json(song);
});

api.patch("/songs/:id", (req, res) => {
  const song = getSong(req.params.id);
  if (!song || !ownsSong(req.user, song)) {
    return res.status(404).json({ error: "השיר לא נמצא" });
  }

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
  if (!song || !ownsSong(req.user, song)) {
    return res.status(404).json({ error: "השיר לא נמצא" });
  }

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
  const existing = getSong(req.params.id);
  if (!existing || !ownsSong(req.user, existing)) {
    return res.status(404).json({ error: "השיר לא נמצא" });
  }
  if (!deleteSong(req.params.id)) return res.status(404).json({ error: "השיר לא נמצא" });
  res.json({ ok: true });
});
