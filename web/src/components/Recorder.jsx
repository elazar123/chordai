import { useEffect, useRef, useState } from "react";
import { formatTime } from "../lib/music.js";

// Safari does not support webm; ask for the first type the browser admits to.
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export default function Recorder({ onRecorded, disabled }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const timerRef = useRef(null);

  // Releasing the mic on unmount matters: otherwise the browser keeps showing
  // the recording indicator after the user navigates away.
  useEffect(() => cleanup, []);

  function cleanup() {
    cancelAnimationFrame(rafRef.current);
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioCtxRef.current = null;
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Keep the music intact — these filters are tuned for speech and would
          // chew up the harmonic content the chord detector relies on.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        cleanup();
        setRecording(false);
        setLevel(0);
        if (blob.size > 0) onRecorded(blob, seconds);
      };

      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);

      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      meter(stream);
    } catch (err) {
      setError(
        err?.name === "NotAllowedError"
          ? "הגישה למיקרופון נדחתה. יש לאשר אותה בהגדרות הדפדפן."
          : "לא הצלחתי לפתוח את המיקרופון: " + (err?.message || err)
      );
    }
  }

  function meter(stream) {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
      setLevel(Math.min(100, (peak / 128) * 160));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  function stop() {
    clearInterval(timerRef.current);
    recorderRef.current?.stop();
  }

  if (typeof MediaRecorder === "undefined") {
    return <div className="error-box">הדפדפן הזה לא תומך בהקלטה. אפשר להעלות קובץ במקום.</div>;
  }

  return (
    <div className="recorder">
      <button
        className={`record-btn${recording ? " recording" : ""}`}
        onClick={recording ? stop : start}
        disabled={disabled}
        aria-label={recording ? "עצור הקלטה" : "התחל הקלטה"}
      >
        {recording ? "■" : "●"}
      </button>

      <div className="rec-time">{formatTime(seconds)}</div>

      <div className="level-meter" aria-hidden="true">
        <div className="level-fill" style={{ width: `${level}%` }} />
      </div>

      <p className="faint" style={{ textAlign: "center", margin: 0 }}>
        {recording
          ? "מקליט… השמע את השיר או נגן אותו, ולחץ לעצירה בסיום."
          : "לחץ על הכפתור והשמע או נגן את השיר. מומלץ לפחות 30 שניות."}
      </p>

      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
