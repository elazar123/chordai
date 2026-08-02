import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatTime } from "../lib/music.js";

const RATES = [0.5, 0.75, 0.9, 1, 1.25, 1.5];

let apiPromise = null;

/** Load YouTube's iframe API once per page and resolve when it is ready. */
function loadYouTubeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * Playback for songs sourced from YouTube.
 * We never keep their audio, so the video itself is the player; we only read its
 * clock to drive the chord highlighting.
 */
const YouTubePlayer = forwardRef(function YouTubePlayer(
  { videoId, onTimeUpdate, duration: fallbackDuration },
  ref
) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const pollRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration || 0);
  const [rate, setRate] = useState(1);
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;

      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            setReady(true);
            setDuration(event.target.getDuration() || fallbackDuration || 0);
          },
          onStateChange: (event) => {
            setPlaying(event.data === YT.PlayerState.PLAYING);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId]);

  // The iframe API has no timeupdate event, so we poll its clock while playing.
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!playing) return;
    pollRef.current = setInterval(() => {
      const current = playerRef.current?.getCurrentTime?.() ?? 0;
      setTime(current);
      onTimeUpdate?.(current);
    }, 120);
    return () => clearInterval(pollRef.current);
  }, [playing, onTimeUpdate]);

  useEffect(() => {
    playerRef.current?.setPlaybackRate?.(rate);
  }, [rate]);

  function toggle() {
    const player = playerRef.current;
    if (!player) return;
    if (playing) player.pauseVideo();
    else player.playVideo();
  }

  function seekTo(value) {
    playerRef.current?.seekTo?.(value, true);
    setTime(value);
    onTimeUpdate?.(value);
  }

  useImperativeHandle(ref, () => ({ seekTo, toggle }), [playing]);

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.code === "ArrowLeft") {
        seekTo(Math.max(0, time - 5));
      } else if (event.code === "ArrowRight") {
        seekTo(time + 5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [time, playing]);

  return (
    <div className="player no-print">
      <div className={`yt-frame${showVideo ? " visible" : ""}`}>
        <div ref={hostRef} />
      </div>

      <div className="player-inner">
        <button
          className="play-btn"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "השהה" : "נגן"}
        >
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
          <button
            className={`btn btn-ghost btn-icon${showVideo ? " active" : ""}`}
            onClick={() => setShowVideo((value) => !value)}
            title={showVideo ? "הסתר וידאו" : "הצג וידאו"}
          >
            ▣
          </button>
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
    </div>
  );
});

export default YouTubePlayer;
