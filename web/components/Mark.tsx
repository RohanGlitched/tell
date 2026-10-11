export function Mark({ size = 22 }: { size?: number }) {
  // An eye-shaped seal with a highlighter stroke: what shows through.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#1a1040" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#5cf2ff" strokeWidth="1.6" />
      <path d="M8.5 16c2.2-3.6 4.7-5.3 7.5-5.3s5.3 1.7 7.5 5.3c-2.2 3.6-4.7 5.3-7.5 5.3S10.7 19.6 8.5 16z" fill="#ff4fd8" />
      <circle cx="16" cy="16" r="2.4" fill="#1a1040" />
    </svg>
  );
}
