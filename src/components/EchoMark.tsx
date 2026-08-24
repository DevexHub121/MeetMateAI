// Echo brand glyph — two linked "echo" rings, an E crossbar, and a voice
// soundwave. Drawn in currentColor so it inherits the surrounding text color
// (used inside the charcoal brand tile in the header). Mirrors the favicon in
// src/app/icon.svg, minus the tile background.
export function EchoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      {/* linked rings */}
      <g stroke="currentColor" strokeWidth="3.4">
        <circle cx="22.5" cy="32" r="12.5" />
        <circle cx="41.5" cy="32" r="12.5" />
      </g>
      {/* E crossbar in the left ring */}
      <line
        x1="14.5"
        y1="32"
        x2="29"
        y2="32"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      {/* voice / soundwave in the right ring */}
      <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <line x1="37.3" y1="28.5" x2="37.3" y2="35.5" />
        <line x1="41.5" y1="24" x2="41.5" y2="40" />
        <line x1="45.7" y1="27" x2="45.7" y2="37" />
      </g>
    </svg>
  );
}
