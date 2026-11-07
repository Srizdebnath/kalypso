import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "yellow" | "pink" | "lime" | "cyan" | "violet" | "white" | "ink" | "danger";

const toneBg: Record<Tone, string> = {
  yellow: "bg-yellow",
  pink: "bg-pink",
  lime: "bg-lime",
  cyan: "bg-cyan",
  violet: "bg-violet",
  white: "bg-white",
  ink: "bg-ink text-paper",
  danger: "bg-danger",
};

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({
  tone = "yellow",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: "sm" | "md" | "lg" }) {
  const sz =
    size === "sm" ? "px-2.5 py-1 text-xs" : size === "lg" ? "px-6 py-3 text-base" : "";
  return <button className={cx("nb-btn", toneBg[tone], sz, className)} {...rest} />;
}

export function Card({
  tone = "white",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx("nb-card p-5", toneBg[tone], className)}>{children}</div>;
}

export function Badge({ tone = "white", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wider",
        toneBg[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#a3a3a3] border-t-transparent",
        className,
      )}
    />
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-sm" role="status">
      <Spinner /> {label}…
    </div>
  );
}

export function ErrorBox({
  error,
  title = "Something went wrong",
  onRetry,
}: {
  error: string;
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="nb-card bg-[#eaeaea] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-bold">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-danger font-mono text-sm">
              !
            </span>
            {title}
          </p>
          <p className="mt-2 break-words font-mono text-sm">{error}</p>
        </div>
        {onRetry && (
          <Button tone="white" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label className="nb-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs opacity-70">{hint}</p>}
    </div>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b-2 border-dashed border-ink/30 py-2 last:border-b-0 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs font-bold uppercase tracking-wide opacity-70">{k}</dt>
      <dd className="min-w-0 break-all font-mono text-sm">{children}</dd>
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  children,
  tone = "yellow",
}: {
  kicker?: string;
  title: ReactNode;
  children?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="mb-8">
      {kicker && (
        <span className={cx("mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 font-mono text-[0.7rem] font-semibold tracking-[0.18em] uppercase", toneBg[tone])}>
          <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
          {kicker}
        </span>
      )}
      <h1 className="text-gradient text-4xl font-bold leading-tight tracking-tight md:text-5xl">{title}</h1>
      {children && <div className="mt-3 max-w-3xl text-lg text-[#c0c0c0]">{children}</div>}
    </div>
  );
}
