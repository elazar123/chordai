import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatTime } from "../lib/music.js";

const RATES = [0.5, 0.75, 0.9, 1, 1.25, 1.5];

/** Exposes { seekTo, toggle } through a ref so the sheet can drive playback. */
const Player = forwardRef(function Player(
  { src, onTimeUpdate, duration: fallbackDuration },
  ref
) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration || 0);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const update = () => {
      setTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime);
    };
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };

    audio.addEventListener("timeupdate", update);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => setPlaying(false));
    audio.addEventListener("error", () => setError("לא הצלחתי לטעון את קובץ השמע"));

    return () => {
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("loadedmetadata", onMeta);
    };
  }, [onTimeUpdate]);

  // Space bar toggles playback, the way every other music app behaves — but not
  // while the user is typing in a field.
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.code === "ArrowLeft") {
        seekBy(-5);
      } else if (event.code === "ArrowRight") {
        seekBy(5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => setError("ההשמעה נחסמה על ידי הדפדפן"));
    else audio.pause();
  }

  function seekBy(delta) {
    const audio = audioRef.current;
    if (audio) audio.currentTime = Math.max(0, audio.currentTime + delta);
  }

  function seekTo(value) {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = value;
      setTime(value);
      onTimeUpdate?.(value);
    }
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  useImperativeHandle(ref, () => ({ seekTo, toggle }), []);

  return (
    <div className="player no-print">
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="player-inner">
        <button className="play-btn" onClick={toggle} aria-label={playing ? "השהה" : "נגן"}>
          {playing ? "❚❚" : "▶"}
        </button>

        <div className="seek">
          <span className="time">{formatTime(time)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(time, duration || 0)}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="מיקום בשיר"
          />
          <span className="time">{formatTime(duration)}</span>
        </div>

        <div className="player-extra">
          <select
            className="rate-select"
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
            aria-label="מהירות ניגון"
          >
            {RATES.map((value) => (
              <option key={value} value={value}>{value}×</option>
            ))}
          </select>
        </div>
      </div>
      {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
});

export default Player;
