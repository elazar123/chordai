import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, IS_STATIC } from "../lib/api.js";
import { formatTime, transposeKey, uniqueChords, toStoredChord } from "../lib/music.js";
import { INSTRUMENTS } from "../lib/instruments.js";
import ChordSheet from "../components/ChordSheet.jsx";
import ChordDiagram from "../components/ChordDiagram.jsx";
import Player from "../components/Player.jsx";
import YouTubePlayer from "../components/YouTubePlayer.jsx";
import LyricsDialog from "../components/LyricsDialog.jsx";

const FONT_MIN = 13;
const FONT_MAX = 30;

export default function SongPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [song, setSong] = useState(null);
  const [error, setError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);

  const [transpose, setTranspose] = useState(0);
  const [capo, setCapo] = useState(0);
  const [fontSize, setFontSize] = useState(17);
  const [autoScroll, setAutoScroll] = useState(true);
  const [preferFlats, setPreferFlats] = useState(false);

  // Display preferences are per-person, not per-song, so they live in the browser.
  const [simplify, setSimplify] = useState(
    () => localStorage.getItem("chordai-simplify") === "1"
  );
  const [instrument, setInstrument] = useState(
    () => localStorage.getItem("chordai-instrument") || "guitar"
  );
  const [showDiagrams, setShowDiagrams] = useState(
    () => localStorage.getItem("chordai-diagrams") !== "0"
  );

  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState(null);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  const playerRef = useRef(null);
  const saveTimer = useRef(null);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  useEffect(() => {
    let cancelled = false;
    api
      .getSong(id)
      .then((data) => !cancelled && setSong(data))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Identity must be stable: Player subscribes to it in an effect.
  const handleTime = useCallback((value) => setCurrentTime(value), []);

  const seek = useCallback((value) => playerRef.current?.seekTo(value), []);

  /** Persist the sheet once the user has stopped editing for a moment. */
  function scheduleSave(blocks) {
    clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        await api.updateSong(id, { blocks });
        setSaveState("saved");
        setTimeout(() => setSaveState(null), 1800);
      } catch (err) {
        setSaveState(null);
        setError(err.message);
      }
    }, 700);
  }

  /**
   * Apply an edit locally, then queue the save.
   * The scheduling deliberately sits outside the state updater: React does not
   * guarantee that side effects inside an updater run (or run only once), which
   * silently dropped saves.
   */
  function updateBlocks(mutate) {
    if (!song) return;
    const next = structuredClone(song);
    mutate(next.blocks);
    setSong(next);
    scheduleSave(next.blocks);
  }

  function handleWordEdit(blockIndex, wordIndex, text) {
    updateBlocks((blocks) => {
      const block = blocks[blockIndex];
      block.words[wordIndex].text = text;
      block.text = block.words.map((word) => word.text).join(" ");
    });
  }

  function handleChordEdit(descriptor, typed) {
    // The user typed what they see, which may be transposed; store the sounding
    // chord so transposition stays a pure view setting.
    const stored = typed ? toStoredChord(typed, { transpose, capo }) : null;

    updateBlocks((blocks) => {
      const block = blocks[descriptor.block];

      if ("inst" in descriptor) {
        if (stored) block.chords[descriptor.inst].chord = stored;
        else block.chords.splice(descriptor.inst, 1);
        return;
      }

      if ("lead" in descriptor) {
        if (stored) block.chordsBefore[descriptor.lead].chord = stored;
        else block.chordsBefore.splice(descriptor.lead, 1);
        return;
      }

      const word = block.words[descriptor.word];
      word.chords = word.chords || [];
      if (!stored) {
        word.chords.splice(descriptor.chord, 1);
      } else if (word.chords[descriptor.chord]) {
        word.chords[descriptor.chord].chord = stored;
      } else {
        // A chord added to a bare word sounds for as long as that word lasts.
        word.chords.push({ chord: stored, start: word.start, end: word.end });
      }
    });
  }

  async function saveLyrics(text) {
    setSaveState("saving");
    try {
      const updated = await api.setLyrics(id, text);
      setSong(updated);
      setLyricsOpen(false);
      setSaveState("saved");
      setTimeout(() => setSaveState(null), 1800);
    } catch (err) {
      setSaveState(null);
      setError(err.message);
    }
  }

  async function remove() {
    if (!confirm(`למחוק את "${song.title}"?`)) return;
    try {
      await api.deleteSong(id);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  }

  if (error) {
    return (
      <div className="container">
        <div className="error-box">{error}</div>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => navigate("/")}>
          חזרה
        </button>
      </div>
    );
  }

  if (!song) {
    return (
      <div className="container">
        <div className="empty">טוען שיר…</div>
      </div>
    );
  }

  const options = { transpose, capo, preferFlats, simplify };
  const chordList = uniqueChords(song.blocks, options);
  const isYouTube = song.source?.type === "youtube";
  const shownKey = transposeKey(song.key, transpose - capo, preferFlats);

  return (
    <div className="container">
      {/* Printed sheets carry their own header, since the on-screen one is hidden. */}
      <div className="print-head">
        <h1>{song.title}</h1>
        <div className="print-meta">
          {[
            song.artist,
            shownKey && `סולם: ${shownKey}`,
            capo > 0 && `קאפו: ${capo}`,
            song.bpm && `${Math.round(song.bpm)} BPM`,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </div>
      </div>

      <div className="song-head no-print">
        {song.thumbnail && (
          <img
            className="song-thumb"
            src={song.thumbnail}
            alt=""
            style={{ width: 78, height: 78 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{song.title}</h1>
          {song.artist && <div className="muted">{song.artist}</div>}
          <div className="badges">
            {shownKey && (
              <span className="badge">סולם <strong>{shownKey}</strong></span>
            )}
            {song.bpm && (
              <span className="badge">קצב <strong>{Math.round(song.bpm)}</strong></span>
            )}
            <span className="badge">אורך <strong>{formatTime(song.duration)}</strong></span>
            {song.source?.type === "youtube" && (
              <a
                className="badge"
                href={song.source.url}
                target="_blank"
                rel="noreferrer"
              >
                ↗ יוטיוב
              </a>
            )}
          </div>
          {chordList.length > 0 && (
            <div className="badges chord-list" style={{ marginTop: 8 }}>
              <span className="faint">אקורדים בשיר:</span>
              {chordList.map((chord) => (
                <span key={chord} className="badge">
                  <strong className="chord-name">{chord}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="toolbar no-print">
        <div className="tool-group">
          <span className="tool-label">טרנספוזיציה</span>
          <button className="btn btn-ghost btn-icon" onClick={() => setTranspose((t) => t - 1)}>−</button>
          <span className="tool-value">{transpose > 0 ? `+${transpose}` : transpose}</span>
          <button className="btn btn-ghost btn-icon" onClick={() => setTranspose((t) => t + 1)}>+</button>
        </div>

        <div className="tool-group">
          <span className="tool-label">קאפו</span>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setCapo((c) => Math.max(0, c - 1))}
          >
            −
          </button>
          <span className="tool-value">{capo}</span>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setCapo((c) => Math.min(11, c + 1))}
          >
            +
          </button>
        </div>

        <div className="tool-group">
          <span className="tool-label">גודל</span>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setFontSize((f) => Math.max(FONT_MIN, f - 1))}
          >
            א−
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setFontSize((f) => Math.min(FONT_MAX, f + 1))}
          >
            א+
          </button>
        </div>

        <div className="tool-group">
          <button
            className="btn btn-ghost"
            onClick={() => setPreferFlats((value) => !value)}
            title="החלפה בין סולמות דיאז לבמול"
          >
            {preferFlats ? "♭" : "♯"}
          </button>
          <button
            className={`btn ${simplify ? "btn-primary" : "btn-ghost"}`}
            onClick={() => {
              const next = !simplify;
              setSimplify(next);
              localStorage.setItem("chordai-simplify", next ? "1" : "0");
            }}
            title="הופך אקורדים מורכבים לבסיסיים — Cmaj7 הופך ל-C"
          >
            אקורדים פשוטים
          </button>
          <button
            className={`btn ${autoScroll ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setAutoScroll((value) => !value)}
          >
            גלילה אוטומטית
          </button>
        </div>

        <div className="tool-group">
          <span className="tool-label">כלי</span>
          <select
            className="rate-select"
            value={instrument}
            onChange={(event) => {
              setInstrument(event.target.value);
              localStorage.setItem("chordai-instrument", event.target.value);
            }}
            aria-label="בחירת כלי נגינה"
          >
            {Object.values(INSTRUMENTS).map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <button
            className={`btn ${showDiagrams ? "btn-primary" : "btn-ghost"}`}
            onClick={() => {
              const next = !showDiagrams;
              setShowDiagrams(next);
              localStorage.setItem("chordai-diagrams", next ? "1" : "0");
            }}
          >
            תרשימים
          </button>
        </div>

        {/* A published bundle is read-only; hide anything that writes. */}
        {!IS_STATIC && (
          <div className="tool-group">
            <button
              className={`btn ${editing ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setEditing((value) => !value)}
              title="לחיצה על מילה או אקורד תאפשר לתקן אותם"
            >
              {editing ? "✓ סיום עריכה" : "✎ עריכה"}
            </button>
            <button className="btn btn-ghost" onClick={() => setLyricsOpen(true)}>
              הדבקת מילים
            </button>
          </div>
        )}

        <div className="topbar-spacer" />

        {saveState && (
          <span className="save-state">
            {saveState === "saving" ? "שומר…" : "נשמר ✓"}
          </span>
        )}

        <div className="tool-group">
          <button className="btn" onClick={() => window.print()}>🖨 הדפסה</button>
          {!IS_STATIC && (
            <button className="btn btn-ghost btn-danger btn-icon" onClick={remove} title="מחיקה">
              🗑
            </button>
          )}
        </div>
      </div>

      {editing && (
        <p className="edit-hint no-print">
          מצב עריכה: לחיצה על מילה או אקורד פותחת אותם לתיקון. לחיצה על + מוסיפה
          אקורד, ומחיקת התוכן מסירה אותו. השינויים נשמרים לבד.
        </p>
      )}

      {showDiagrams && chordList.length > 0 && (
        <div className="diagram-strip">
          {chordList.map((chord) => (
            <ChordDiagram key={chord} name={chord} instrument={instrument} />
          ))}
        </div>
      )}

      {song.blocks?.length ? (
        <div style={{ "--sheet-size": `${fontSize}px` }}>
          <ChordSheet
            blocks={song.blocks}
            options={options}
            currentTime={currentTime}
            autoScroll={autoScroll}
            onSeek={seek}
            editing={editing}
            onWordEdit={handleWordEdit}
            onChordEdit={handleChordEdit}
          />
        </div>
      ) : (
        <div className="empty">לא זוהו אקורדים בשיר הזה.</div>
      )}

      {lyricsOpen && (
        <LyricsDialog
          song={song}
          onSave={saveLyrics}
          onClose={() => setLyricsOpen(false)}
        />
      )}

      {/* YouTube songs keep no audio of ours — playback comes from their player. */}
      {isYouTube ? (
        <YouTubePlayer
          ref={playerRef}
          videoId={song.source.videoId}
          duration={song.duration}
          onTimeUpdate={handleTime}
        />
      ) : (
        <Player
          ref={playerRef}
          src={song.audioUrl}
          duration={song.duration}
          onTimeUpdate={handleTime}
        />
      )}
    </div>
  );
}
