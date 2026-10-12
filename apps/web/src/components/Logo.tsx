/**
 * The app's mark: a calendar with a tick, on an indigo tile.
 * Decorative: the screen always shows the word "Tasks" next to it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#4338ca" />
      <g fill="none" stroke="#fff" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
        <rect x="112" y="136" width="288" height="264" rx="40" />
        <path d="M112 216h288M184 104v64M328 104v64" />
        <path d="m192 302 44 44 84-88" />
      </g>
    </svg>
  );
}
