/**
 * Publish the generated site/ folder to the gh-pages branch.
 *
 * The branch holds only the built songbook — it shares no history with main, so
 * republishing never grows the repo with old copies of the bundle.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "../server/config.js";

const siteDir = path.join(ROOT, "site");
const BRANCH = "gh-pages";

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...options }).trim();
}

if (!fs.existsSync(path.join(siteDir, "index.html"))) {
  console.error("לא נמצאה תיקיית site/ — הרץ קודם: npm run publish:site");
  process.exit(1);
}

let remote;
try {
  remote = git(["remote", "get-url", "origin"]);
} catch {
  console.error("אין remote בשם origin. חבר את המאגר ל-GitHub קודם.");
  process.exit(1);
}

// Build the branch in a scratch clone so the working tree is never touched.
const work = fs.mkdtempSync(path.join(ROOT, ".ghpages-"));
try {
  execFileSync("git", ["init", "-q", work], { stdio: "pipe" });
  const run = (args) => execFileSync("git", args, { cwd: work, stdio: "pipe" });

  run(["checkout", "-q", "-b", BRANCH]);
  fs.cpSync(siteDir, work, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git`) });

  run(["add", "-A"]);
  run([
    "-c", "user.name=chordai",
    "-c", "user.email=chordai@local",
    "commit", "-q", "-m", `פרסום אתר — ${new Date().toISOString()}`,
  ]);
  run(["remote", "add", "origin", remote]);
  run(["push", "-q", "--force", "origin", BRANCH]);

  const slug = remote.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
  const [owner, repo] = slug.split("/");

  console.log(`\n✅ פורסם לענף ${BRANCH}`);
  console.log(`\n   כתובת האתר:  https://${owner}.github.io/${repo}/`);
  console.log(`\n   אם זו הפעם הראשונה — הפעל פעם אחת ב-GitHub:`);
  console.log(`   Settings → Pages → Source: Deploy from a branch → ${BRANCH} / root\n`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
