"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noSubscribe = () => () => {};
/** False during server render and hydration, true after: safe to use document. */
export const useMounted = () => useSyncExternalStore(noSubscribe, () => true, () => false);

export const TOTAL_STEPS = 8;

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
export { cx };

/** Top bar: back arrow, logo and a thin yellow progress bar with "Step N of 8". */
export function TopBar({ step, onBack }: { step: number; onBack?: () => void }) {
  return (
    <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-4">
        <div className="w-10">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-neutral-800 transition hover:bg-neutral-100 active:scale-95"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        {/* The JPG (303x172) has empty space above and below the artwork (rows 49-156):
            show only the artwork, 31 px tall. */}
        <Link href="/" aria-label="ArticL home" className="inline-flex h-[31px] overflow-hidden">
          <Image
            src="/logos/header-logo.jpg"
            alt="ArticL"
            width={303}
            height={172}
            className="h-[49px] w-auto max-w-none -translate-y-[28.5%]"
            priority
          />
        </Link>
        <span className="w-10 text-right text-[11px] font-medium tabular-nums text-neutral-400">
          {step}/{TOTAL_STEPS}
        </span>
      </div>
      <div className="mx-auto h-[3px] w-full max-w-md px-4">
        <div className="h-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** Step heading: small label, big title, short helper line. */
export function StepHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="pt-6 pb-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{eyebrow}</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] text-neutral-950">{title}</h1>
      {children && <p className="mt-2 text-[15px] leading-relaxed text-neutral-500">{children}</p>}
    </header>
  );
}

/** Bottom action bar in thumb reach, above the iPhone home indicator. */
export function ActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  // Portaled to <body>: a moving (transformed) parent would otherwise carry the fixed bar with it.
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(
    <div className="a2r fixed inset-x-0 bottom-0 z-20 border-t border-neutral-100 bg-white/92 backdrop-blur-md">
      <div className="mx-auto w-full max-w-md px-4 pt-3 pb-[max(0.85rem,env(safe-area-inset-bottom))]">
        {note && <div className="mb-2 text-center text-[12px] text-neutral-500">{note}</div>}
        <div className="flex gap-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; busy?: boolean };

export function Button({ variant = "primary", busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cx(
        "relative inline-flex h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed",
        variant === "primary" &&
          "bg-brand text-neutral-950 shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_20px_-8px_rgba(242,194,0,0.7)] hover:bg-[var(--a2r-brand-strong)] disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none",
        variant === "secondary" && "border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50 disabled:text-neutral-300",
        variant === "ghost" && "h-10 flex-none px-3 text-[13px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300",
        className,
      )}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Soft card. `selected` draws the yellow ring. */
export function Card({
  children,
  className,
  selected,
  index,
  as: As = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  selected?: boolean;
  /** Stagger position for the rise-in animation. */
  index?: number;
  as?: "div" | "button" | "label" | "li";
} & Record<string, unknown>) {
  return (
    <As
      className={cx(
        "a2r-rise block w-full rounded-[20px] border bg-white text-left transition duration-200",
        selected
          ? "border-transparent shadow-[0_0_0_2px_var(--a2r-brand),0_10px_30px_-16px_rgba(0,0,0,0.25)]"
          : "border-neutral-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
        As === "button" && "active:scale-[0.99]",
        className,
      )}
      style={{ "--i": index ?? 0 } as CSSProperties}
      {...rest}
    >
      {children}
    </As>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "warn" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-semibold tracking-wide",
        tone === "neutral" && "bg-neutral-100 text-neutral-600",
        tone === "brand" && "bg-brand text-neutral-950",
        tone === "warn" && "bg-orange-50 text-[var(--a2r-warn)]",
      )}
    >
      {children}
    </span>
  );
}

/** iOS-style switch. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        "relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40",
        on ? "bg-brand" : "bg-neutral-200",
      )}
    >
      <span
        className={cx(
          "absolute top-[3px] left-[3px] h-6 w-6 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)] transition-transform duration-200 [transition-timing-function:var(--a2r-ease)]",
          on && "translate-x-5",
        )}
      />
    </button>
  );
}

/** Segmented choice (music mood, split style, platform tabs). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string; disabled?: boolean; icon?: ReactNode }[];
  value: T | undefined;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cx("flex rounded-xl bg-neutral-100 p-1", disabled && "opacity-40")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition duration-200 disabled:text-neutral-300",
            value === o.value ? "bg-white text-neutral-950 shadow-[0_1px_3px_rgba(0,0,0,0.08)]" : "text-neutral-500",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("a2r-skeleton rounded-xl", className)} />;
}

/** "Working on it" line with a pulsing yellow dot. */
export function Working({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-neutral-500">
      <span className="a2r-pulse h-2 w-2 rounded-full bg-brand" />
      {children}
    </p>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="a2r-rise mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[13px] leading-relaxed text-red-700">
      {children}
    </p>
  );
}

export function Check({ className }: { className?: string }) {
  return (
    <span className={cx("a2r-pop flex h-5 w-5 items-center justify-center rounded-full bg-brand", className)}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#111" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Collapsible section that animates its height. */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="a2r-fold" data-open={open}>
      <div>{children}</div>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  const base =
    "mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3.5 text-[15px] text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-neutral-900 focus:shadow-[0_0_0_3px_var(--a2r-brand-tint)]";
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-neutral-500">{label}</span>
      {multiline ? (
        <textarea
          className={cx(base, "min-h-[96px] resize-none py-3 leading-relaxed")}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={cx(base, "h-12")}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
