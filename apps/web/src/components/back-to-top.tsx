"use client";

export function BackToTop() {
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="group flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-white/70 transition-colors hover:border-white/40 hover:text-white"
    >
      Back to top <span className="transition-transform group-hover:-translate-y-0.5">↑</span>
    </button>
  );
}
