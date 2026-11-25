"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noSubscribe = () => () => {};
/** False during server render and hydration, true after: safe to use document. */
export const useMounted = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/** Listed steps in the desktop rail (start UI merges 1–2). */
export const TOTAL_STEPS = 7;

/**
 * Map the internal flow step (1–7) to the listed rail step (1–7).
 * Audience is listed as 2; build + result both map to 7.
 */
export function listedStep(flowStep: number, audienceRecovery = false): number {
  if (audienceRecovery) return 2;
  if (flowStep <= 1) return 1;
  if (flowStep >= 6) return 7;
  return flowStep + 1;
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
export { cx };

function subscribeLg(cb: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** True at the `lg` breakpoint (desktop create chrome). */
export const useDesktop = () => useSyncExternalStore(subscribeLg, () => window.matchMedia("(min-width: 1024px)").matches, () => false);

/** Top bar: logo on the left, optional action on the right, yellow progress bar. */
export function TopBar({
  step,
  onBack,
  action,
}: {
  step: number;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-md items-center gap-2 px-4 lg:max-w-6xl lg:px-6">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-800 transition hover:bg-neutral-100 active:scale-95"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {/* The JPG (303x172) has empty space above and below the artwork (rows 49-156):
            show only the artwork, 31 px tall. */}
        <Link href="/" aria-label="ArticL home" className="inline-flex h-[31px] shrink-0 overflow-hidden">
          <Image
            src="/logos/header-logo.jpg"
            alt="ArticL"
            width={303}
            height={172}
            className="h-[49px] w-auto max-w-none -translate-y-[28.5%]"
            priority
          />
        </Link>
        <div className="ml-auto flex shrink-0 items-center">{action}</div>
      </div>
      <div className="mx-auto h-[3px] w-full max-w-md px-4 lg:max-w-6xl lg:px-6">
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

/** Step heading: grey label + step count, big title, short helper line. */
export function StepHeading({
  step,
  eyebrow,
  title,
  children,
}: {
  step: number;
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="pt-6 pb-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{eyebrow}</p>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-neutral-400">
          {step}/{TOTAL_STEPS}
        </span>
      </div>
      <h1 className="mt-2 text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] text-neutral-950">{title}</h1>
      {children && <p className="mt-2 text-[15px] leading-relaxed text-neutral-500">{children}</p>}
    </header>
  );
}

/** Tracks `#a2r-left-col` so a fixed ActionBar can match the left pane on desktop. */
function useLeftColumnBox(enabled: boolean) {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    if (!enabled) {
      setBox(null);
      return;
    }
    const el = document.getElementById("a2r-left-col");
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ left: r.left, width: r.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enabled]);
  return box;
}

/**
 * Bottom action bar. Portaled so a transformed step parent can't carry it.
 * `pin="viewport"` stays fixed to the screen (width matches the left column on desktop);
 * `pin="column"` docks in the desktop left-column slot when present.
 */
export function ActionBar({
  children,
  note,
  pin = "column",
}: {
  children: ReactNode;
  note?: ReactNode;
  pin?: "column" | "viewport";
}) {
  const mounted = useMounted();
  const desktop = useDesktop();
  const leftBox = useLeftColumnBox(mounted && pin === "viewport" && desktop);
  if (!mounted) return null;
  const slot = pin === "column" && desktop ? document.getElementById("a2r-action-slot") : null;
  const target = slot ?? document.body;
  const docked = target !== document.body;
  const pinnedToColumn = !docked && pin === "viewport" && desktop && leftBox;
  return createPortal(
    <div
      className={cx(
        "a2r z-20 border-t border-neutral-100 bg-white/92 backdrop-blur-md",
        docked ? "pointer-events-auto relative mt-6 w-full" : "fixed bottom-0",
        !docked && !pinnedToColumn && "inset-x-0",
      )}
      style={
        pinnedToColumn
          ? { left: leftBox.left, width: leftBox.width, right: "auto" }
          : undefined
      }
    >
      <div
        className={cx(
          "w-full pt-3",
          docked
            ? "px-0 pb-3"
            : "px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))]",
          !docked && !pinnedToColumn && "mx-auto max-w-md",
        )}
      >
        {note && <div className="mb-2 text-center text-[12px] text-neutral-500">{note}</div>}
        <div className="flex w-full gap-2">{children}</div>
      </div>
    </div>,
    target,
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
