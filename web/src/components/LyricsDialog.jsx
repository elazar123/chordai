import { useEffect, useMemo, useRef, useState } from "react";

/** Current lyrics as plain text, so the user edits rather than retypes. */
function currentLyrics(song) {
  return (song.blocks || [])
    .filter((block) => block.type === "line")
    .map((block) => (block.stanzaBreak ? "\n" : "") + block.text)
    .join("\n")
    .trim();
}

export default function LyricsDialog({ song, onSave, onClose }) {
  const initial = useMemo(() => currentLyrics(song), [song]);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef(null);

  useEffect(() => {
    areaRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="הדבקת מילות השיר"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 style={{ fontSize: 19, marginBottom: 6 }}>הדבקת מילות השיר</h2>
        <p className="faint" style={{ marginTop: 0 }}>
          הדבק את המילים הנכונות, שורה אחת לכל שורת שיר. המערכת תסנכרן אותן לאודיו
          ותציב מחדש את האקורדים. שורה ריקה מפרידה בין בתים.
        </p>

        <textarea
          ref={areaRef}
          className="input lyrics-area"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"שורה ראשונה של השיר\nשורה שנייה\n\nבית שני מתחיל כאן"}
          disabled={busy}
          rows={14}
        />

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? <span className="spinner" /> : "סנכרן מילים"}
          </button>
        </div>
      </div>
    </div>
  );
}
