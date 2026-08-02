/**
 * A published bundle has no server behind it: the chord sheets are plain JSON
 * files sitting next to the page. `publish.js` sets this flag in index.html.
 */
export const IS_STATIC = Boolean(globalThis.window?.__CHORDAI_STATIC__);

const READ_ONLY = "האתר הזה הוא גרסה לצפייה בלבד — לעריכה יש לפתוח את ChordAI המקומי";

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(body?.error || `שגיאה ${response.status}`);
  }
  return body;
}

/** Read a file from the published bundle, relative to wherever it is hosted. */
async function readStatic(file) {
  const response = await fetch(`./data/${file}`, { cache: "no-cache" });
  if (!response.ok) throw new Error("לא הצלחתי לטעון את השיר");
  return response.json();
}

function refuse() {
  return Promise.reject(new Error(READ_ONLY));
}

export const api = {
  session: () =>
    IS_STATIC
      ? Promise.resolve({ authEnabled: false, user: null, static: true })
      : request("/api/auth/session"),

  logout: () => (IS_STATIC ? Promise.resolve({}) : request("/api/auth/logout", { method: "POST" })),

  listSongs: () => (IS_STATIC ? readStatic("index.json") : request("/api/songs")),

  getSong: (id) => (IS_STATIC ? readStatic(`songs/${id}.json`) : request(`/api/songs/${id}`)),

  // Everything below changes data, which a published bundle cannot do.
  updateSong: (id, patch) =>
    IS_STATIC
      ? refuse()
      : request(`/api/songs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),

  deleteSong: (id) =>
    IS_STATIC ? refuse() : request(`/api/songs/${id}`, { method: "DELETE" }),

  setLyrics: (id, lyrics) =>
    IS_STATIC
      ? refuse()
      : request(`/api/songs/${id}/lyrics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lyrics }),
        }),

  analyzeYouTube: (payload) =>
    IS_STATIC
      ? refuse()
      : request("/api/analyze/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),

  analyzeUpload: (formData) =>
    IS_STATIC ? refuse() : request("/api/analyze/upload", { method: "POST", body: formData }),
};

/**
 * Follow a job's progress over server-sent events.
 * Returns an unsubscribe function; the stream closes itself when the job ends.
 */
export function subscribeToJob(jobId, { onProgress, onDone, onError }) {
  const source = new EventSource(`/api/jobs/${jobId}/events`);

  source.onmessage = (event) => {
    const job = JSON.parse(event.data);
    onProgress?.(job);
    if (job.status === "done") {
      source.close();
      onDone?.(job);
    } else if (job.status === "error") {
      source.close();
      onError?.(new Error(job.error || "העיבוד נכשל"));
    }
  };

  source.onerror = () => {
    // EventSource retries on its own; only treat a closed stream as fatal.
    if (source.readyState === EventSource.CLOSED) {
      onError?.(new Error("החיבור לשרת נותק"));
    }
  };

  return () => source.close();
}
