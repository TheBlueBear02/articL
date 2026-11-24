import type { CSSProperties } from "react";

/** The audiences a video can be made for, shown on the start page (picked in step 2). */
const TYPES: { who: string; format: string; soon?: boolean; icon: React.ReactNode }[] = [
  {
    who: "General public",
    format: "Social reel",
    icon: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  },
  {
    who: "Students",
    format: "Student reel",
    icon: <path d="M12 4L2 9l10 5 10-5-10-5zm-6 7.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5" />,
  },
  {
    who: "Peers & policymakers",
    format: "LinkedIn reel",
    // A briefcase.
    icon: <path d="M4 8h16v11H4zM9 8V6a1 1 0 011-1h4a1 1 0 011 1v2M4 13h16" />,
  },
];

/** Three columns: who the reel can be made for, in the brand yellow. */
export function AudienceTypes() {
  return (
    <section className="mt-10" aria-label="Who it's for">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-950">Customize based on the target audience you choose</h2>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {TYPES.map((t, i) => (
          <li
            key={t.who}
            className="a2r-rise flex flex-col items-center rounded-[18px] border-2 border-brand bg-white px-2 pt-4 pb-3 text-center"
            style={{ "--i": i } as CSSProperties}
          >
            <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${t.soon ? "bg-brand/50" : "bg-brand"}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                {t.icon}
              </svg>
            </span>
            <span className="mt-2.5 text-[13px] font-semibold leading-tight text-neutral-950">{t.who}</span>
            <span className="mt-0.5 text-[11px] leading-tight text-neutral-600">{t.format}</span>
            {t.soon && (
              <span className="mt-2 rounded-full bg-white px-2 py-[2px] text-[10px] font-semibold tracking-wide text-neutral-600">Coming soon</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
