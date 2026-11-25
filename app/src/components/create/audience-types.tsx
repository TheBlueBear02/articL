"use client";

import { useState, type CSSProperties } from "react";
import { Fold, cx } from "./ui";

/** The audiences a video can be made for, shown on the start page (picked in step 2). */
const TYPES: { who: string; format: string; duration: string; soon?: boolean; icon: React.ReactNode; structure: string[] }[] = [
  {
    who: "General public",
    format: "Social reel",
    duration: "Up to 60 s",
    icon: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
    structure: ["Hook", "Findings (strongest last)", "Closing that loops"],
  },
  {
    who: "Students",
    format: "Student reel",
    duration: "60–90 s",
    icon: <path d="M12 4L2 9l10 5 10-5-10-5zm-6 7.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5" />,
    structure: ["The question", "How they tested it", "What they found", "Why it matters"],
  },
  {
    who: "Peers & policymakers",
    format: "LinkedIn reel",
    duration: "About 90 s",
    // A briefcase.
    icon: <path d="M4 8h16v11H4zM9 8V6a1 1 0 011-1h4a1 1 0 011 1v2M4 13h16" />,
    structure: ["Opening", "Motivation", "Method", "Findings", "Limitation & implication", "Closing"],
  },
];

function scrollToUpload() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Three columns: click a card to expand script-structure chips inside the yellow block. */
export function AudienceTypes() {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <section className="mt-10" aria-label="Who it's for">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-950">Customize based on the target audience you choose</h2>
      <ul className="mt-3 grid grid-cols-3 items-start gap-2">
        {TYPES.map((t, i) => {
          const structureOpen = !!open[t.who];
          return (
            <li key={t.who} className="a2r-rise" style={{ "--i": i } as CSSProperties}>
              <div className="relative flex w-full cursor-pointer flex-col items-center overflow-hidden rounded-[18px] border-2 border-brand bg-white px-0.5 pt-4 pb-3 text-center">
                <div
                  className="brand-lines-section pointer-events-none absolute inset-0 opacity-20"
                  aria-hidden
                />
                <button
                  type="button"
                  aria-expanded={structureOpen}
                  onClick={() => setOpen((s) => ({ ...s, [t.who]: !structureOpen }))}
                  className="relative z-10 flex w-full cursor-pointer flex-col items-center px-0.5 text-center"
                >
                  <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${t.soon ? "bg-brand/50" : "bg-brand"}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                      {t.icon}
                    </svg>
                  </span>
                  {/* Two-line title slot so shorter names match “Peers & policymakers” on mobile. */}
                  <span className="mt-2.5 flex min-h-[2.6em] items-center justify-center px-1 text-[13px] font-semibold leading-tight text-neutral-950">
                    {t.who}
                  </span>
                  <span className="mt-0.5 px-1 text-[11px] leading-tight text-neutral-600">{t.format}</span>
                  <span className="mt-1 text-[11px] font-medium tabular-nums text-neutral-500">{t.duration}</span>
                  {t.soon && (
                    <span className="mt-2 rounded-full bg-white px-2 py-[2px] text-[10px] font-semibold tracking-wide text-neutral-600">Coming soon</span>
                  )}
                  <svg
                    className={cx("mt-2 shrink-0 transition-transform duration-300", structureOpen && "rotate-180")}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" stroke="#a3a3a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className="relative z-10 mt-2 w-full self-stretch px-1.5">
                  <Fold open={structureOpen}>
                    <ol className="w-full space-y-1.5 pb-1">
                      {t.structure.map((section) => (
                        <li
                          key={section}
                          className="block w-full rounded-xl bg-white px-1.5 py-2.5 text-center text-[11px] font-medium leading-snug text-neutral-800 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                        >
                          {section}
                        </li>
                      ))}
                    </ol>
                    <button
                      type="button"
                      onClick={scrollToUpload}
                      className="mt-2 mb-0.5 w-full cursor-pointer rounded-xl bg-brand px-1.5 py-2.5 text-center text-[12px] font-semibold text-neutral-950 transition hover:brightness-95 active:scale-[0.98]"
                    >
                      Create video
                    </button>
                  </Fold>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
