/** The Wayfinder logo: a direction arrow with a short trail behind it. Keep in step with public/logo-mark.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="7.5" fill="var(--accent)" />
      <path
        d="M19.5 5 25.5 21.5 19.5 17.8 13.5 21.5z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="11.2" cy="25.2" r="1.7" fill="#9be8c4" />
      <circle cx="6.8" cy="27" r="1.3" fill="#9be8c4" opacity=".7" />
    </svg>
  );
}
