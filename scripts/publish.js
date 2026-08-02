/**
 * Build a standalone, serverless copy of the songbook.
 *
 * A finished chord sheet is just text plus a YouTube video id — none of the AI
 * is needed to read one. So the library can be published as plain files that any
 * free static host will serve forever, with nothing running at home.
 *
 *   node scripts/publish.js [--out site] [--include-audio]
 *
 * Songs sourced from an upload or a recording only play if their audio comes
 * along, which is what --include-audio does; YouTube songs always play from
 * YouTube and never carry audio.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, config } from "../server/config.js";
import { listSongs, getSong } from "../server/lib/store.js";

const args = process.argv.slice(2);
const outDir = path.resolve(ROOT, valueOf("--out") || "site");
const includeAudio = args.includes("--include-audio");

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

log("\n📦 בונה אתר סטטי\n");

// 1. Fresh UI bundle.
log("  · בונה את הממשק");
execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "pipe" });

// 2. Start from a clean directory so deleted songs do not linger.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "data", "songs"), { recursive: true });
fs.cpSync(config.webDist, outDir, { recursive: true });

// 3. Mark the bundle as static; the client swaps to reading files and hides
//    every control that would need a server.
const indexPath = path.join(outDir, "index.html");
const html = fs
  .readFileSync(indexPath, "utf8")
  .replace("<head>", `<head>\n    <script>window.__CHORDAI_STATIC__=true</script>`);
fs.writeFileSync(indexPath, html, "utf8");

// 4. Songs as plain JSON.
const songs = listSongs();
let copiedAudio = 0;
let skipped = 0;
const summaries = [];

for (const summary of songs) {
  const song = getSong(summary.id);
  if (!song) continue;

  const playable = song.source?.type === "youtube" || includeAudio;
  if (!playable) {
    // Without its audio the song would open with a dead player.
    skipped++;
    continue;
  }

  if (song.source?.type === "youtube") {
    // Songs analysed before we stopped keeping YouTube audio still carry a path
    // to a file that is not in the bundle. Playback uses the YouTube player, so
    // clear it rather than ship a broken reference.
    song.audioFile = null;
    song.audioUrl = null;
  } else if (includeAudio && song.audioFile) {
    const from = path.join(config.audioDir, song.audioFile);
    if (fs.existsSync(from)) {
      fs.mkdirSync(path.join(outDir, "audio"), { recursive: true });
      fs.copyFileSync(from, path.join(outDir, "audio", song.audioFile));
      song.audioUrl = `./audio/${song.audioFile}`;
      copiedAudio++;
    }
  }

  // Owner and raw transcription are internal; a public songbook needs neither.
  delete song.owner;
  delete song.asrWords;
  delete song.audioHash;

  fs.writeFileSync(
    path.join(outDir, "data", "songs", `${song.id}.json`),
    JSON.stringify(song),
    "utf8"
  );
  summaries.push(summary);
}

fs.writeFileSync(
  path.join(outDir, "data", "index.json"),
  JSON.stringify(summaries),
  "utf8"
);

// 5. GitHub Pages serves _-prefixed paths through Jekyll unless told not to.
fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");

const size = execFileSync("du", ["-sh", outDir], { encoding: "utf8" }).split("\t")[0];

log(`  · ${summaries.length} שירים`);
if (copiedAudio) log(`  · ${copiedAudio} קבצי שמע הועתקו`);
if (skipped) {
  log(`  · ${skipped} שירים דולגו (הקלטות בלי אודיו — הוסף --include-audio)`);
}
log(`\n✅ מוכן: ${path.relative(ROOT, outDir)}/  (${size})\n`);
log("   להעלאה: גרור את התיקייה ל-netlify.com/drop,");
log("   או:     npm run publish:github\n");
