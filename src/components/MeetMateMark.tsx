/**
 * MeetMate brand glyph — two figures leaning together into an M, with a
 * microphone held between them.
 *
 * Drawn rather than bitmapped so it stays crisp from a 15px favicon to a 120px
 * hero, weighs a few hundred bytes, and needs no network request on first
 * paint. The two-tone gradient is the brand's; `mono` falls back to
 * currentColor for places that set their own colour — a white-on-gradient
 * header, or a disabled state — where a fixed blue-to-purple would fight the
 * surface it sits on.
 *
 * The gradient id is suffixed per instance: two of these on one page with the
 * same id makes the second silently adopt the first's fill.
 */
export function MeetMateMark({
  size = 20,
  mono = false,
}: {
  size?: number;
  /** Ignore the brand gradient and inherit the surrounding text colour. */
  mono?: boolean;
}) {
  const id = `mm-${mono ? "mono" : "grad"}-${size}`;
  const fill = mono ? "currentColor" : `url(#${id})`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      {!mono && (
        <defs>
          <linearGradient id={id} x1="6" y1="8" x2="58" y2="58" gradientUnits="userSpaceOnUse">
            <stop stopColor="#22A6F2" />
            <stop offset="1" stopColor="#A855F7" />
          </linearGradient>
        </defs>
      )}

      {/* Heads */}
      <circle cx="19" cy="17" r="8.5" fill={fill} />
      <circle cx="45" cy="17" r="8.5" fill={fill} />

      {/*
        Bodies: two strokes down, and two leaning in to meet in the middle.
        Together they read as an M without ever drawing a letter — the join in
        the centre is the handshake the wordmark is named for.
      */}
      <g
        stroke={fill}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M11 54V33" />
        <path d="M53 54V33" />
        <path d="M13 30c6-2 12 2 19 9" />
        <path d="M51 30c-6-2-12 2-19 9" />
      </g>

      {/* The microphone they are gathered around. */}
      <rect x="28.5" y="30" width="7" height="12" rx="3.5" fill={fill} />
      <path
        d="M25 40a7 7 0 0 0 14 0"
        stroke={fill}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
