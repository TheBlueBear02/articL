"use client";

import { AUDIENCE_HINT, AUDIENCE_LABEL, AUDIENCES, READY_AUDIENCES, type Audience } from "@/lib/jobs";

type Props = {
  audience: Audience;
  onChange: (audience: Audience) => void;
  disabled?: boolean;
  canGenerate?: boolean;
  busy?: boolean;
  onGenerate?: () => void;
};

/** Target audience picker — right column on desktop, stacked under the article on mobile. */
export function AudienceSidebar({ audience, onChange, disabled, canGenerate, busy, onGenerate }: Props) {
  return (
    <aside className="flex flex-col rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/50 lg:sticky lg:top-6 lg:min-h-[32rem]">
      <h2 className="text-sm font-semibold tracking-tight">Who is the video for?</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        This shapes the script, length and on-screen labels.
      </p>

      <div role="radiogroup" aria-label="Target audience" className="mt-4 flex flex-col gap-2">
        {AUDIENCES.map((a) => {
          const ready = READY_AUDIENCES.includes(a);
          const on = audience === a;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!ready || disabled}
              title={AUDIENCE_HINT[a]}
              onClick={() => onChange(a)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${
                on
                  ? "border-brand bg-brand text-neutral-900 shadow-sm"
                  : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-950"
              } ${ready ? "cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500" : "cursor-not-allowed opacity-40"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`text-sm ${on ? "font-semibold" : "font-medium"}`}>{AUDIENCE_LABEL[a]}</span>
                {!ready && <span className="text-[11px] font-medium uppercase tracking-wide opacity-70">Soon</span>}
              </span>
              <span className={`mt-0.5 block text-xs leading-snug ${on ? "text-neutral-800" : "text-neutral-500 dark:text-neutral-400"}`}>
                {AUDIENCE_HINT[a]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto pt-6">
        <button
          type="button"
          disabled={busy || disabled || !canGenerate}
          onClick={onGenerate}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-neutral-900 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-neutral-900" fill="currentColor" aria-hidden>
            {/* Soft 4-point sparkles like the reference, black for the yellow button. */}
            <path d="M10 1.5C10.5 7.2 14.3 10.5 20 11c-5.7.5-9.5 3.8-10 9.5C9.5 14.8 5.7 11.5 0 11c5.7-.5 9.5-3.8 10-9.5Z" />
            <path d="M18.5 14C18.75 16.9 20.6 18.25 23.5 18.5c-2.9.25-4.75 1.6-5 4.5-.25-2.9-2.1-4.25-5-4.5 2.9-.25 4.75-1.6 5-4.5Z" />
          </svg>
          {busy ? "Starting…" : "Generate video"}
        </button>
      </div>
    </aside>
  );
}
