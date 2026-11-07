/** Kalypso mark: an angular K. Takes the current text color, so it fits dark and light pages. */
export function KLogo({ className = "h-6 w-6", title = "Kalypso" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 278 223" className={className} fill="currentColor" role="img" aria-label={title}>
      <path d="M1 222 L70 10 Q73 1 83 1 L131 1 L108 73 L198 5 Q203 1 211 1 L277 1 L208 53 Q195 64 203 79 L248 178 L193 178 Q181 178 175 167 L157 133 Q148 117 135 127 Z" />
    </svg>
  );
}
