import { chordShape, chordPitchClasses, INSTRUMENTS } from "../lib/instruments.js";

const FRET_COUNT = 4;
const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEYS = [1, 3, 6, 8, 10];
// Where each black key sits, measured in white-key widths from the left.
const BLACK_OFFSET = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };

/** Fretboard grid for guitar/ukulele, or a keyboard for piano. */
export default function ChordDiagram({ name, instrument = "guitar", size = 1 }) {
  if (instrument === "piano") return <PianoDiagram name={name} size={size} />;

  const shape = chordShape(name, instrument);
  const stringCount = INSTRUMENTS[instrument]?.tuning.length ?? 6;

  const width = 20 + (stringCount - 1) * 15;
  const height = 92;

  if (!shape) {
    return (
      <div className="chord-diagram" style={{ width: width * size }}>
        <div className="diagram-name">{name}</div>
        <div className="diagram-missing">—</div>
      </div>
    );
  }

  const { frets, baseFret } = shape;
  const left = 10;
  const top = 16;
  const stringGap = 15;
  const fretGap = 15;
  const boardWidth = (stringCount - 1) * stringGap;

  return (
    <div className="chord-diagram" style={{ width: width * size }}>
      <div className="diagram-name">{name}</div>
      <svg viewBox={`0 0 ${width} ${height}`} width={width * size} height={height * size}>
        {/* An open position shows a thick nut; higher up we label the fret instead. */}
        {baseFret === 1 ? (
          <rect x={left} y={top - 3} width={boardWidth} height={3} className="dg-nut" />
        ) : (
          <text x={left - 3} y={top + 11} className="dg-fretlabel" textAnchor="end">
            {baseFret}
          </text>
        )}

        {Array.from({ length: FRET_COUNT + 1 }, (_, i) => (
          <line
            key={`f${i}`}
            x1={left}
            y1={top + i * fretGap}
            x2={left + boardWidth}
            y2={top + i * fretGap}
            className="dg-line"
          />
        ))}

        {Array.from({ length: stringCount }, (_, i) => (
          <line
            key={`s${i}`}
            x1={left + i * stringGap}
            y1={top}
            x2={left + i * stringGap}
            y2={top + FRET_COUNT * fretGap}
            className="dg-line"
          />
        ))}

        {frets.map((fret, index) => {
          const x = left + index * stringGap;

          if (fret === null) {
            return (
              <text key={index} x={x} y={top - 5} className="dg-mark" textAnchor="middle">
                ✕
              </text>
            );
          }
          if (fret === 0) {
            return (
              <circle key={index} cx={x} cy={top - 8} r={3} className="dg-open" />
            );
          }

          const relative = fret - baseFret + 1;
          if (relative < 1 || relative > FRET_COUNT) return null;
          return (
            <circle
              key={index}
              cx={x}
              cy={top + relative * fretGap - fretGap / 2}
              r={5}
              className="dg-dot"
            />
          );
        })}
      </svg>
    </div>
  );
}

function PianoDiagram({ name, size }) {
  const pitches = chordPitchClasses(name);
  const keyWidth = 11;
  const width = WHITE_KEYS.length * keyWidth;
  const height = 62;

  return (
    <div className="chord-diagram" style={{ width: width * size }}>
      <div className="diagram-name">{name}</div>
      <svg viewBox={`0 0 ${width} ${height}`} width={width * size} height={height * size}>
        {WHITE_KEYS.map((pitch, i) => (
          <rect
            key={`w${pitch}`}
            x={i * keyWidth}
            y={10}
            width={keyWidth}
            height={48}
            rx={1.5}
            className={`dg-key-white${pitches?.includes(pitch) ? " on" : ""}`}
          />
        ))}
        {BLACK_KEYS.map((pitch) => (
          <rect
            key={`b${pitch}`}
            x={BLACK_OFFSET[pitch] * keyWidth - 3.6}
            y={10}
            width={7.2}
            height={30}
            rx={1.2}
            className={`dg-key-black${pitches?.includes(pitch) ? " on" : ""}`}
          />
        ))}
      </svg>
    </div>
  );
}
