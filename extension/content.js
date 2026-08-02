/**
 * The on-page chord box.
 *
 * Taps the YouTube <video> element's audio, runs it through the detector, and
 * shows the chord that is sounding right now plus the ones just before it.
 * Everything happens in this tab — no server, no account, nothing to install
 * beyond the extension itself.
 */

const FFT_SIZE = 8192;
const HISTORY = 7;

const state = {
  audio: null,        // { context, analyser, buffer }
  detector: null,
  video: null,
  panel: null,
  history: [],        // most recent last
  running: false,
  collapsed: false,
  transpose: 0,
  simple: true,
  stability: "normal",
};

/* ---------- audio ---------- */

function attach(video) {
  if (state.audio && state.video === video) return true;

  try {
    const context = new AudioContext();
    const source = context.createMediaElementSource(video);
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.55;

    // The tap must be in parallel with the speakers. Routing a media element
    // through an AudioContext and forgetting to reconnect it silences the tab.
    source.connect(analyser);
    source.connect(context.destination);

    state.audio = { context, analyser, buffer: new Float32Array(analyser.frequencyBinCount) };
    state.detector = new ChordDetector(context.sampleRate, FFT_SIZE);
    state.video = video;
    return true;
  } catch (error) {
    // createMediaElementSource throws if this element was already tapped, which
    // happens when YouTube reuses the player across navigations.
    console.warn("[ChordAI] לא הצלחתי להתחבר לאודיו:", error);
    return false;
  }
}

function tick() {
  if (!state.running) return;
  requestAnimationFrame(tick);

  const { analyser, buffer, context } = state.audio || {};
  if (!analyser) return;
  if (context.state === "suspended") context.resume().catch(() => {});
  if (state.video?.paused) return;

  analyser.getFloatFrequencyData(buffer);
  // Playback position drives the minimum-duration rule, so it survives seeking.
  const chord = state.detector.push(buffer, state.video.currentTime);
  if (!chord) return;

  const last = state.history[state.history.length - 1];
  if (last?.name !== chord) {
    state.history.push({ name: chord, at: state.video.currentTime });
    if (state.history.length > HISTORY) state.history.shift();
    render();
  }
}

/* ---------- chord display ---------- */

const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_TO_INDEX = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
};

function displayName(name) {
  const match = name.match(/^([A-G]#?)(.*)$/);
  if (!match) return name;

  let [, root, suffix] = match;
  if (state.simple) {
    // Keep what changes the chord's identity, drop the decoration.
    if (suffix.startsWith("dim")) suffix = "dim";
    else if (suffix.startsWith("m") && !suffix.startsWith("maj")) suffix = "m";
    else suffix = "";
  }
  if (state.transpose) {
    const index = NOTE_TO_INDEX[root];
    if (index !== undefined) {
      root = NOTES_SHARP[(((index + state.transpose) % 12) + 12) % 12];
    }
  }
  return root + suffix;
}

/* ---------- panel ---------- */

function buildPanel() {
  const panel = document.createElement("div");
  panel.className = "chordai-panel";
  panel.innerHTML = `
    <div class="chordai-head">
      <span class="chordai-title">ChordAI <b class="chordai-ver"></b></span>
      <div class="chordai-actions">
        <button class="chordai-btn" data-act="down" title="הורד חצי טון">−</button>
        <span class="chordai-transpose">0</span>
        <button class="chordai-btn" data-act="up" title="העלה חצי טון">+</button>
        <button class="chordai-btn" data-act="simple" title="אקורדים פשוטים">♪</button>
        <button class="chordai-btn chordai-stab" data-act="stability" title="יציבות הזיהוי">≡</button>
        <button class="chordai-btn" data-act="fold" title="כווץ">▾</button>
      </div>
    </div>
    <div class="chordai-body">
      <div class="chordai-now">—</div>
      <div class="chordai-history"></div>
      <div class="chordai-hint">מנגן שיר? האקורדים יופיעו כאן</div>
    </div>
  `;

  panel.querySelector('[data-act="up"]').onclick = () => {
    state.transpose = Math.min(11, state.transpose + 1);
    render();
  };
  panel.querySelector('[data-act="down"]').onclick = () => {
    state.transpose = Math.max(-11, state.transpose - 1);
    render();
  };
  panel.querySelector('[data-act="simple"]').onclick = (event) => {
    state.simple = !state.simple;
    event.currentTarget.classList.toggle("on", state.simple);
    render();
  };
  panel.querySelector('[data-act="stability"]').onclick = (event) => {
    const order = ["responsive", "normal", "steady"];
    const next = order[(order.indexOf(state.stability) + 1) % order.length];
    state.stability = next;
    state.detector?.setStability(next);
    chrome.storage?.sync?.set({ stability: next });
    showStability(event.currentTarget);
  };

  panel.querySelector('[data-act="fold"]').onclick = (event) => {
    state.collapsed = !state.collapsed;
    panel.classList.toggle("collapsed", state.collapsed);
    event.currentTarget.textContent = state.collapsed ? "▴" : "▾";
  };
  panel.querySelector('[data-act="simple"]').classList.toggle("on", state.simple);
  showStability(panel.querySelector('[data-act="stability"]'));

  // Showing the version makes "did my update actually load?" answerable at a
  // glance, instead of guessing from behaviour.
  const version = chrome.runtime?.getManifest?.()?.version;
  if (version) panel.querySelector(".chordai-ver").textContent = version;

  makeDraggable(panel, panel.querySelector(".chordai-head"));
  document.body.appendChild(panel);
  return panel;
}

const STABILITY_LABELS = {
  responsive: { glyph: "≡", text: "רגיש — מחליף מהר" },
  normal: { glyph: "≣", text: "רגיל" },
  steady: { glyph: "▤", text: "יציב — מחזיק אקורד" },
};

function showStability(button) {
  const info = STABILITY_LABELS[state.stability] || STABILITY_LABELS.normal;
  button.textContent = info.glyph;
  button.title = `יציבות: ${info.text}`;
  button.classList.toggle("on", state.stability !== "normal");
}

function makeDraggable(panel, handle) {
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const onMove = (event) => {
    panel.style.left = `${originX + event.clientX - startX}px`;
    panel.style.top = `${originY + event.clientY - startY}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    chrome.storage?.sync?.set({ pos: { left: panel.style.left, top: panel.style.top } });
  };

  handle.addEventListener("mousedown", (event) => {
    if (event.target.closest(".chordai-btn")) return;
    const box = panel.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originX = box.left;
    originY = box.top;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    event.preventDefault();
  });
}

function render() {
  if (!state.panel) return;

  const now = state.history[state.history.length - 1];
  const previous = state.history.slice(0, -1);

  state.panel.querySelector(".chordai-now").textContent = now ? displayName(now.name) : "—";
  state.panel.querySelector(".chordai-transpose").textContent =
    state.transpose > 0 ? `+${state.transpose}` : String(state.transpose);

  state.panel.querySelector(".chordai-history").innerHTML = previous
    .map((entry) => `<span>${displayName(entry.name)}</span>`)
    .join("");

  state.panel.querySelector(".chordai-hint").style.display = now ? "none" : "";
}

/* ---------- lifecycle ---------- */

function start() {
  const video = document.querySelector("video");
  if (!video) return;
  if (!attach(video)) return;

  if (!state.panel) {
    state.panel = buildPanel();
    chrome.storage?.sync?.get(["pos", "stability"], ({ pos, stability }) => {
      if (pos?.left) {
        state.panel.style.left = pos.left;
        state.panel.style.top = pos.top;
        state.panel.style.right = "auto";
        state.panel.style.bottom = "auto";
      }
      if (stability) {
        state.stability = stability;
        state.detector?.setStability(stability);
        showStability(state.panel.querySelector('[data-act="stability"]'));
      }
    });
  }

  if (!state.running) {
    state.running = true;
    tick();
  }

  // A new video means a fresh chord history.
  video.addEventListener("loadstart", () => {
    state.history = [];
    state.detector.reset();
    render();
  });
}

// YouTube is a single-page app: the watch page can appear without a page load.
const observer = new MutationObserver(() => {
  if (location.pathname.startsWith("/watch") && document.querySelector("video")) start();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

if (location.pathname.startsWith("/watch")) start();
