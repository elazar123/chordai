import express from "express";
import cookieParser from "cookie-parser";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { api } from "./routes/api.js";
import { readSession, authEnabled } from "./lib/auth.js";

const app = express();

// Sessions ride on a cookie, so the API must stay same-origin. Enabling CORS
// here would let any site make credentialed calls on a signed-in user's behalf.
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));

app.use("/api", readSession, api);

// Audio is served with range support so the player can seek without downloading
// the whole file first.
app.use(
  "/audio",
  express.static(config.audioDir, {
    acceptRanges: true,
    maxAge: "1h",
    fallthrough: false,
  })
);

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  // Client-side routing: anything that is not an API or asset path gets the app.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/audio")) return next();
    res.sendFile(path.join(config.webDist, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  const message =
    error.code === "LIMIT_FILE_SIZE"
      ? `הקובץ גדול מדי (מקסימום ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB)`
      : error.message || "שגיאת שרת";
  res.status(status).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`\n  🎸 ChordAI`);
  console.log(`  שרת רץ על http://localhost:${config.port}`);
  if (!fs.existsSync(config.webDist)) {
    console.log(`  (מצב פיתוח — הממשק רץ בנפרד על Vite)`);
  }
  console.log(`  מודל תמלול: ${config.whisperModel} | שפה: ${config.defaultLanguage}`);
  console.log(
    authEnabled()
      ? `  התחברות: גוגל${config.allowedEmails.length ? ` (${config.allowedEmails.length} כתובות מורשות)` : ""}`
      : `  התחברות: כבויה — מצב מקומי פתוח`
  );
  console.log("");
});
