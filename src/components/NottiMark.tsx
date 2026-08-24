// Notti brand glyph — a rounded note card with a voice soundwave, drawn in
// currentColor so it inherits the surrounding text color. Voice in, notes out.
export function NottiMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="12" y="10" width="40" height="44" rx="10" stroke="currentColor" strokeWidth="3.4" />
      <g stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
        <line x1="24" y1="28" x2="24" y2="36" />
        <line x1="32" y1="22" x2="32" y2="42" />
        <line x1="40" y1="26" x2="40" y2="38" />
      </g>
    </svg>
  );
}
