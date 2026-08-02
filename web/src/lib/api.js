async function request(url, options = {}) {
  const response = await fetch(url, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(body?.error || `שגיאה ${response.status}`);
  }
  return body;
}

export const api = {
  session: () => request("/api/auth/session"),

  logout: () => request("/api/auth/logout", { method: "POST" }),

  listSongs: () => request("/api/songs"),

  getSong: (id) => request(`/api/songs/${id}`),

  updateSong: (id, patch) =>
    request(`/api/songs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),

  deleteSong: (id) => request(`/api/songs/${id}`, { method: "DELETE" }),

  setLyrics: (id, lyrics) =>
    request(`/api/songs/${id}/lyrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lyrics }),
    }),

  analyzeYouTube: (payload) =>
    request("/api/analyze/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  analyzeUpload: (formData) =>
    request("/api/analyze/upload", { method: "POST", body: formData }),
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
