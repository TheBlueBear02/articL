"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Margalit & Shayo paper → existing reel: wipe paper into the thumbnail. */
const PAPER = "/demo/paper-page.jpg";
const THUMB = "/demo/reel-thumb.jpg";

/** Paper page ~1200×1552; reel is 9:16. */
const PAPER_RATIO = 1200 / 1552;
const REEL_RATIO = 9 / 16;

/**
 * Demo on /create: the paper's first page, with a horizontal line. Scrolling the page (or dragging
 * the line) moves it down so the reel thumbnail covers the paper. Sticky while you scrub through.
 */
export function PaperToReel() {
  const track = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [reveal, setReveal] = useState(0);

  const revealFromScroll = useCallback(() => {
    if (dragging.current) return;
    const el = track.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const range = Math.max(1, rect.height - window.innerHeight);
    setReveal(Math.min(1, Math.max(0, -rect.top / range)));
  }, []);

  const setFromClientY = useCallback((clientY: number) => {
    const el = frame.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setReveal(Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)));
  }, []);

  useEffect(() => {
    revealFromScroll();
    window.addEventListener("scroll", revealFromScroll, { passive: true });
    window.addEventListener("resize", revealFromScroll);
    return () => {
      window.removeEventListener("scroll", revealFromScroll);
      window.removeEventListener("resize", revealFromScroll);
    };
  }, [revealFromScroll]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      setFromClientY(e.clientY);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      revealFromScroll();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [setFromClientY, revealFromScroll]);

  function startDrag(e: ReactPointerEvent) {
    e.preventDefault();
    dragging.current = true;
    setFromClientY(e.clientY);
  }

  const ratio = PAPER_RATIO + (REEL_RATIO - PAPER_RATIO) * reveal;
  const linePct = `${reveal * 100}%`;
  const clipBottom = `${(1 - reveal) * 100}%`;

  return (
    <section ref={track} className="relative mt-10 h-[160vh]" aria-label="Paper to reel">
      {/* Sticks under the create top bar while this tall track is scrolled through. */}
      <div className="sticky top-16">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-950">Watch a paper become a reel</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">Scroll — or drag the line — to cover the page with the reel.</p>

        <div
          ref={frame}
          role="slider"
          aria-label="Reveal reel over paper"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(reveal * 100)}
          tabIndex={0}
          className="relative mt-4 touch-none select-none overflow-hidden rounded-[18px] border border-neutral-200 bg-neutral-100 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.45)] outline-none focus-visible:shadow-[0_0_0_2px_var(--a2r-brand)]"
          style={{ aspectRatio: String(ratio) }}
          onPointerDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              setReveal((r) => Math.min(1, r + 0.05));
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
              e.preventDefault();
              setReveal((r) => Math.max(0, r - 0.05));
            } else if (e.key === "Home") {
              e.preventDefault();
              setReveal(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setReveal(1);
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static demo asset */}
          <img
            src={PAPER}
            alt="First page of How Markets Shape Social Values and Political Preferences"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />

          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 ${clipBottom} 0)` }} aria-hidden={reveal < 0.02}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static demo asset */}
            <img src={THUMB} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
          </div>

          <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: linePct, transform: "translateY(-50%)" }}>
            <div className="h-[2px] w-full bg-brand shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" />
            <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-[0_6px_16px_-6px_rgba(0,0,0,0.35)]">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 3v10M5 6l3-3 3 3M5 10l3 3 3-3" stroke="#111" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm">
            Reel
          </span>
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-neutral-700 shadow-sm">
            Paper
          </span>
        </div>

        <p className="mt-2 text-[12px] text-neutral-400">
          Margalit &amp; Shayo, <span className="italic">How Markets Shape Social Values…</span>
        </p>
      </div>
    </section>
  );
}
