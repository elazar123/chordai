import { useEffect, useRef, useState } from "react";
import { displayChord } from "../lib/music.js";

/** Small in-place editor used for both words and chord names. */
function InlineInput({ value, className, placeholder, onCommit, onCancel }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className={`inline-edit ${className}`}
      value={draft}
      placeholder={placeholder}
      size={Math.max(2, draft.length + 1)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(draft);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export default function ChordSheet({
  blocks,
  options,
  currentTime = 0,
  autoScroll = false,
  onSeek,
  editing = false,
  onWordEdit,
  onChordEdit,
}) {
  const activeRef = useRef(null);
  const lastActiveRef = useRef(-1);
  const [target, setTarget] = useState(null);

  const activeIndex = blocks.findIndex(
    (block) => currentTime >= block.start && currentTime < block.end
  );

  useEffect(() => {
    // Autoscroll would yank the page away from whatever is being edited.
    if (!autoScroll || editing || activeIndex < 0) return;
    if (activeIndex === lastActiveRef.current) return;
    lastActiveRef.current = activeIndex;
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex, autoScroll, editing]);

  useEffect(() => {
    if (!editing) setTarget(null);
  }, [editing]);

  const isPlaying = (chord) => currentTime >= chord.start && currentTime < chord.end;
  const sameTarget = (a, b) =>
    a && b && Object.keys(b).every((key) => a[key] === b[key]);

  /** A chord slot: rendered as text, or as an input when it is being edited. */
  function ChordSlot({ chord, descriptor, playing }) {
    const shown = chord ? displayChord(chord.chord, options) : "";

    if (editing && sameTarget(target, descriptor)) {
      return (
        <InlineInput
          value={shown}
          className="chord-input"
          placeholder="אקורד"
          onCommit={(next) => {
            setTarget(null);
            if (next.trim() !== shown) onChordEdit?.(descriptor, next.trim());
          }}
          onCancel={() => setTarget(null)}
        />
      );
    }

    if (!chord) {
      // In edit mode an empty slot is an invitation to add a chord.
      return editing ? (
        <span
          className="chord chord-add"
          onClick={() => setTarget(descriptor)}
          title="הוספת אקורד"
        >
          +
        </span>
      ) : (
        <span className="chord-spacer" />
      );
    }

    return (
      <span
        className={`chord${playing ? " playing" : ""}${editing ? " editable" : ""}`}
        onClick={() => (editing ? setTarget(descriptor) : onSeek?.(chord.start))}
      >
        {shown}
      </span>
    );
  }

  return (
    <div className={`sheet${editing ? " editing" : ""}`}>
      {blocks.map((block, index) => {
        const active = index === activeIndex;
        const ref = active ? activeRef : null;

        if (block.type === "instrumental") {
          return (
            <div
              key={index}
              ref={ref}
              className={`instrumental${active ? " active" : ""}`}
              onDoubleClick={() => !editing && onSeek?.(block.start)}
            >
              <span className="instrumental-tag">נגינה</span>
              {block.chords.map((chord, i) => (
                <ChordSlot
                  key={i}
                  chord={chord}
                  playing={isPlaying(chord)}
                  descriptor={{ block: index, inst: i }}
                />
              ))}
            </div>
          );
        }

        const leading = block.chordsBefore || [];

        return (
          <div key={index} className={`block${block.stanzaBreak ? " stanza-break" : ""}`}>
            <div
              ref={ref}
              className={`line${active ? " active" : ""}`}
              onDoubleClick={() => !editing && onSeek?.(block.start)}
            >
              {leading.map((chord, i) => (
                <span className="unit" key={`lead-${i}`}>
                  <ChordSlot
                    chord={chord}
                    playing={isPlaying(chord)}
                    descriptor={{ block: index, lead: i }}
                  />
                  <span className="word"> </span>
                </span>
              ))}

              {block.words.map((word, i) => {
                const wordTarget = { block: index, word: i, text: true };
                return (
                  <span className="unit" key={i}>
                    {word.chords?.length ? (
                      <span className="chord-row">
                        {word.chords.map((chord, c) => (
                          <ChordSlot
                            key={c}
                            chord={chord}
                            playing={isPlaying(chord)}
                            descriptor={{ block: index, word: i, chord: c }}
                          />
                        ))}
                      </span>
                    ) : (
                      <ChordSlot descriptor={{ block: index, word: i, chord: 0 }} />
                    )}

                    {editing && sameTarget(target, wordTarget) ? (
                      <InlineInput
                        value={word.text}
                        className="word-input"
                        onCommit={(next) => {
                          setTarget(null);
                          if (next !== word.text) onWordEdit?.(index, i, next);
                        }}
                        onCancel={() => setTarget(null)}
                      />
                    ) : (
                      <span
                        className={`word${editing ? " editable" : ""}`}
                        onClick={() => editing && setTarget(wordTarget)}
                      >
                        {word.text}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
