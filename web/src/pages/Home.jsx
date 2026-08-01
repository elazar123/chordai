import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, subscribeToJob } from "../lib/api.js";
import { formatTime } from "../lib/music.js";
import Recorder from "../components/Recorder.jsx";

const TABS = [
  { id: "youtube", label: "קישור מיוטיוב" },
  { id: "record", label: "הקלטה" },
  { id: "upload", label: "העלאת קובץ" },
];

const LANGUAGES = [
  { value: "he", label: "עברית" },
  { value: "en", label: "אנגלית" },
  { value: "auto", label: "זיהוי אוטומטי" },
];

const MODELS = [
  { value: "small", label: "מהיר (small)" },
  { value: "medium", label: "מאוזן (medium)" },
  { value: "large-v3", label: "מדויק — מומלץ לעברית (large-v3)" },
];

export default function Home() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("youtube");
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("he");
  const [model, setModel] = useState("large-v3");
  const [skipLyrics, setSkipLyrics] = useState(false);
  const [reanalyze, setReanalyze] = useState(false);

  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);

  const fileInputRef = useRef(null);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    loadLibrary();
    return () => unsubscribeRef.current?.();
  }, []);

  async function loadLibrary() {
    try {
      setSongs(await api.listSongs());
    } catch {
      /* An empty library is not worth an error banner. */
    } finally {
      setLoadingLibrary(false);
    }
  }

  function track(jobId) {
    unsubscribeRef.current?.();
    unsubscribeRef.current = subscribeToJob(jobId, {
      onProgress: setJob,
      onDone: (finished) => navigate(`/song/${finished.songId}`),
      onError: (err) => {
        setError(err.message);
        setJob(null);
      },
    });
  }

  async function submitYouTube(event) {
    event.preventDefault();
    setError(null);
    if (!url.trim()) return;
    try {
      setJob({ status: "queued", pct: 0, message: "שולח בקשה" });
      const result = await api.analyzeYouTube({
        url,
        language,
        model,
        skipLyrics,
        force: reanalyze,
      });
      // A song we already have comes back immediately, with no job to follow.
      if (result.cached) return navigate(`/song/${result.songId}`);
      track(result.jobId);
    } catch (err) {
      setError(err.message);
      setJob(null);
    }
  }

  async function submitAudio(blob, name, origin) {
    setError(null);
    try {
      setJob({ status: "queued", pct: 0, message: "מעלה קובץ" });
      const form = new FormData();
      form.append("audio", blob, name);
      form.append("title", name.replace(/\.[^.]+$/, ""));
      form.append("origin", origin);
      form.append("language", language);
      form.append("model", model);
      form.append("skipLyrics", String(skipLyrics));
      if (reanalyze) form.append("force", "true");
      const result = await api.analyzeUpload(form);
      if (result.cached) return navigate(`/song/${result.songId}`);
      track(result.jobId);
    } catch (err) {
      setError(err.message);
      setJob(null);
    }
  }

  const busy = Boolean(job) && job.status !== "error";

  return (
    <div className="container">
      <div className="hero">
        <h1>אקורדים ומילים — מכל שיר</h1>
        <p>הדבק קישור מיוטיוב, הקלט שיר, או העלה קובץ. תקבל דף אקורדים מסודר.</p>
      </div>

      <div className="card">
        <div className="tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              className="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              disabled={busy}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "youtube" && (
          <form onSubmit={submitYouTube}>
            <label className="label" htmlFor="yt-url">כתובת הסרטון</label>
            <div className="field-row">
              <input
                id="yt-url"
                className="input input-ltr"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy}
              />
              <button className="btn btn-primary" disabled={busy || !url.trim()}>
                {busy ? <span className="spinner" /> : "נתח שיר"}
              </button>
            </div>
          </form>
        )}

        {tab === "record" && (
          <Recorder
            disabled={busy}
            onRecorded={(blob) => submitAudio(blob, "recording.webm", "recording")}
          />
        )}

        {tab === "upload" && (
          <div>
            <label className="label">קובץ שמע או וידאו</label>
            <input
              ref={fileInputRef}
              className="input"
              type="file"
              accept="audio/*,video/*"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) submitAudio(file, file.name, "upload");
              }}
            />
            <p className="faint" style={{ marginBottom: 0 }}>
              נתמכים mp3, wav, m4a, webm, mp4 ועוד.
            </p>
          </div>
        )}

        <div className="options">
          <label className="option">
            שפת השיר
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={busy}
            >
              {LANGUAGES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="option">
            דיוק התמלול
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={busy}
            >
              {MODELS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={skipLyrics}
              onChange={(event) => setSkipLyrics(event.target.checked)}
              disabled={busy}
            />
            אקורדים בלבד (בלי מילים)
          </label>

          <label className="checkbox" title="שיר שכבר נותח נפתח מיד מהספרייה">
            <input
              type="checkbox"
              checked={reanalyze}
              onChange={(event) => setReanalyze(event.target.checked)}
              disabled={busy}
            />
            לנתח מחדש גם אם השיר כבר קיים
          </label>
        </div>

        {job && (
          <div className="progress-wrap">
            <div className="progress-head">
              <span>{job.message}</span>
              <span className="muted">{Math.round(job.pct || 0)}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${job.pct || 0}%` }} />
            </div>
            <p className="faint" style={{ margin: "10px 0 0" }}>
              ניתוח שיר שלם לוקח בדרך כלל דקה עד שלוש. אפשר להשאיר את החלון פתוח.
            </p>
          </div>
        )}

        {error && <div className="error-box">{error}</div>}
      </div>

      <div className="section-title">
        <h2 style={{ fontSize: 19 }}>השירים שלי</h2>
        {songs.length > 0 && <span className="faint">{songs.length} שירים</span>}
      </div>

      {loadingLibrary ? (
        <div className="empty">טוען…</div>
      ) : songs.length === 0 ? (
        <div className="empty">עדיין אין שירים. נתח שיר ראשון כדי להתחיל.</div>
      ) : (
        <div className="song-grid">
          {songs.map((song) => (
            <SongCard key={song.id} song={song} onOpen={() => navigate(`/song/${song.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SongCard({ song, onOpen }) {
  return (
    <div className="song-card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(event) => event.key === "Enter" && onOpen()}>
      {song.thumbnail ? (
        <img className="song-thumb" src={song.thumbnail} alt="" loading="lazy" />
      ) : (
        <div className="song-thumb">{song.source?.type === "recording" ? "🎤" : "♪"}</div>
      )}
      <div className="song-info">
        <div className="song-title">{song.title}</div>
        <div className="song-meta">
          {song.key && <span>{song.key}</span>}
          {song.duration ? <span>{formatTime(song.duration)}</span> : null}
          {!song.hasLyrics && <span>אקורדים בלבד</span>}
        </div>
      </div>
    </div>
  );
}
