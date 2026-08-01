import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env reader so the project has no dotenv dependency.
function loadEnvFile() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const venvPython = path.join(ROOT, ".venv", "bin", "python");

/**
 * Resolve a command to its absolute path.
 * yt-dlp's --ffmpeg-location wants a real path and silently ignores a bare
 * command name, so "ffmpeg" alone is not good enough here.
 */
function resolveBinary(name) {
  if (name.includes("/")) return name;
  try {
    return execFileSync("/usr/bin/which", [name], { encoding: "utf8" }).trim() || name;
  } catch {
    return name;
  }
}

export const config = {
  port: Number(process.env.PORT || 5178),
  dataDir: path.join(ROOT, "data"),
  audioDir: path.join(ROOT, "data", "audio"),
  songsDir: path.join(ROOT, "data", "songs"),
  analyzerDir: path.join(ROOT, "analyzer"),
  webDist: path.join(ROOT, "web", "dist"),

  python: process.env.CHORDAI_PYTHON || (fs.existsSync(venvPython) ? venvPython : "python3"),
  ytdlp: resolveBinary(process.env.CHORDAI_YTDLP || "yt-dlp"),
  ffmpeg: resolveBinary(process.env.CHORDAI_FFMPEG || "ffmpeg"),

  // large-v3 is noticeably better on sung Hebrew than medium, which is the whole
  // point of this instance; the extra runtime is worth it on this machine.
  whisperModel: process.env.CHORDAI_WHISPER_MODEL || "large-v3",
  // Default to Hebrew since that is what this instance is mainly used for.
  // Set to "auto" to let Whisper detect the language per song.
  defaultLanguage: process.env.CHORDAI_LANGUAGE || "he",

  // Vocal separation before analysis. Costs extra time per song but is the
  // single biggest accuracy win, for both lyrics and chords.
  separateVocals: process.env.CHORDAI_SEPARATE !== "false",
  separationDevice: process.env.CHORDAI_SEPARATION_DEVICE || "mps",

  maxUploadBytes: Number(process.env.CHORDAI_MAX_UPLOAD || 200 * 1024 * 1024),
};

for (const dir of [config.dataDir, config.audioDir, config.songsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
