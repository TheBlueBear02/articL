"use client";

import { useId, useState } from "react";

const FAQS: { q: string; a: string }[] = [
  {
    q: "What do I need to start?",
    a: "A research paper as a PDF (under 20 MB) or pasted text. Pick who the video is for — Social or Student — then generate.",
  },
  {
    q: "How long does a video take?",
    a: "Finding points takes under a minute. Building the reel usually takes about 5 minutes for Social and 8 for Student, most of that in rendering.",
  },
  {
    q: "Are the numbers in the video accurate?",
    a: "Every figure we keep is checked against a quote from your paper. If a number isn't in the source sentence, it doesn't make it into the script.",
  },
  {
    q: "What's the difference between Social and Student?",
    a: "Social is a short hooky reel of the main findings (up to about 60 s). Student walks through the question, how it was tested, and what was found (60–90 s), with section labels on screen.",
  },
  {
    q: "Can I edit the script before it renders?",
    a: "Not yet on the home flow. The script is written and checked automatically. Script review before render is on the roadmap.",
  },
];

/**
 * Q&A accordion: white and quiet, with vertical yellow lines from the logo L.
 * `compact` tightens padding and type for the narrow /create column (and small phones).
 */
export function HomeFaq({ compact = false }: { compact?: boolean }) {
  const baseId = useId();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      className={
        compact
          ? "relative mt-10 overflow-hidden rounded-[22px] border border-neutral-200/70 bg-white px-4 py-8"
          : "relative mt-16 overflow-hidden rounded-3xl border border-neutral-200/70 bg-white px-5 py-10 sm:mt-20 sm:px-10 sm:py-12"
      }
    >
      {/* More vertical yellow lines from the right; fade out before the questions */}
      <div
        className={
          compact
            ? "pointer-events-none absolute inset-y-0 right-0 w-[55%]"
            : "pointer-events-none absolute inset-y-0 right-0 w-[58%] sm:w-[52%] lg:w-[46%]"
        }
        style={{
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, transparent 35%, rgba(0,0,0,0.08) 55%, rgba(0,0,0,0.3) 72%, rgba(0,0,0,0.72) 88%, #000 100%)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, transparent 35%, rgba(0,0,0,0.08) 55%, rgba(0,0,0,0.3) 72%, rgba(0,0,0,0.72) 88%, #000 100%)",
        }}
        aria-hidden
      >
        <div className="brand-lines-section absolute inset-0" />
      </div>

      <div className="relative z-10 max-w-2xl">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-brand uppercase">Q&A</p>
        <h2
          className={
            compact
              ? "mt-1 text-[1.65rem] font-semibold leading-tight tracking-tight text-neutral-950"
              : "mt-1 text-3xl font-semibold tracking-tight text-neutral-950 sm:text-4xl lg:text-[2.75rem] lg:leading-tight"
          }
        >
          Have a question?
          <br />
          We have answers
        </h2>

        <ul className={`divide-y divide-neutral-200/90 border-y border-neutral-200/90 ${compact ? "mt-6" : "mt-8"}`}>
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            const panelId = `${baseId}-panel-${i}`;
            const buttonId = `${baseId}-btn-${i}`;
            return (
              <li key={item.q}>
                <button
                  type="button"
                  id={buttonId}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className={`flex w-full cursor-pointer items-start justify-between gap-3 text-left ${compact ? "py-3.5" : "gap-4 py-4"}`}
                >
                  <span className={`font-medium tracking-tight text-neutral-900 ${compact ? "text-[14px] leading-snug" : "text-[15px] sm:text-base"}`}>
                    {item.q}
                  </span>
                  <span className="mt-0.5 shrink-0 text-xl leading-none font-light text-neutral-950" aria-hidden>
                    {isOpen ? "–" : "+"}
                  </span>
                </button>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className={`leading-relaxed text-neutral-600 ${compact ? "pb-3.5 pr-6 text-[13px]" : "pb-4 pr-10 text-sm sm:text-[15px]"}`}>
                      {item.a}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
