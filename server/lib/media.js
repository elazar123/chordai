import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/** Run a command with argv (never a shell string) and collect its output. */
export function run(command, args, { onStdoutLine, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let buffer = "";

    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!onStdoutLine) return;
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onStdoutLine(line);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(
        new Error(
          `לא הצלחתי להריץ "${command}". ודא שהוא מותקן וזמין ב-PATH. (${error.message})`
        )
      );
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (buffer.trim() && onStdoutLine) onStdoutLine(buffer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} יצא עם קוד ${code}`));
    });
  });
}

/**
 * SHA-256 of a file's contents, streamed so a large upload never sits in memory.
 * Lets us recognise the same recording uploaded twice.
 */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export function parseYouTubeUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  const id =
    url.hostname.endsWith("youtu.be")
      ? url.pathname.slice(1).split("/")[0]
      : url.searchParams.get("v") || url.pathname.split("/").pop();

  if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return null;
  return { videoId: id, url: url.toString() };
}

export async function fetchYouTubeMetadata(url) {
  const { stdout } = await run(
    config.ytdlp,
    ["--dump-single-json", "--no-playlist", "--skip-download", url],
    { timeoutMs: 90_000 }
  );
  const info = JSON.parse(stdout);
  return {
    title: info.title || "שיר ללא שם",
    artist: info.artist || info.uploader || info.channel || null,
    duration: info.duration || null,
    thumbnail: info.thumbnail || null,
  };
}

/** Download a YouTube video's audio track as mp3. Returns the file path. */
export async function downloadYouTubeAudio(url, id, onProgress) {
  const output = path.join(config.audioDir, `${id}.%(ext)s`);
  // Point yt-dlp at ffmpeg only when we have a real path; a bad value here makes
  // it skip the mp3 conversion entirely instead of failing loudly.
  const ffmpegArgs = fs.existsSync(config.ffmpeg)
    ? ["--ffmpeg-location", config.ffmpeg]
    : [];

  await run(
    config.ytdlp,
    [
      "--no-playlist",
      "-f", "bestaudio/best",
      "-x", "--audio-format", "mp3", "--audio-quality", "0",
      ...ffmpegArgs,
      "--newline",
      "-o", output,
      url,
    ],
    {
      timeoutMs: 15 * 60_000,
      onStdoutLine: (line) => {
        const match = line.match(/\[download\]\s+([\d.]+)%/);
        if (match && onProgress) onProgress(Number(match[1]));
      },
    }
  );

  const file = path.join(config.audioDir, `${id}.mp3`);
  if (!fs.existsSync(file)) throw new Error("ההורדה הסתיימה אך קובץ השמע לא נוצר");
  return file;
}

/**
 * Normalise any uploaded/recorded file into mono 22.05kHz mp3.
 * Browser recordings arrive as webm/opus, which librosa cannot read directly.
 */
export async function convertToMp3(inputPath, id) {
  const output = path.join(config.audioDir, `${id}.mp3`);
  await run(
    config.ffmpeg,
    ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "22050", "-b:a", "128k", output],
    { timeoutMs: 10 * 60_000 }
  );
  if (!fs.existsSync(output)) throw new Error("המרת האודיו נכשלה");
  return output;
}
