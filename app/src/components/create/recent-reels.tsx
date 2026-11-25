"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { readJson } from "@/lib/api-client";
import { AUDIENCE_LABEL, audienceOf } from "@/lib/jobs";
import type { ReelCard } from "@/app/api/reels/route";
import { Skeleton } from "./ui";

const COUNT = 6;

/**
 * The last 6 finished videos, as reel-shaped cards in a row that swipes sideways. Videos from the
 * new flow open on their result step; older ones on their job page. Loaded once per visit.
 */
export function RecentReels() {
  const [reels, setReels] = useState<ReelCard[] | null>(null);

  useEffect(() => {
    fetch(`/api/reels?limit=${COUNT}`)
      .then(readJson)
      .then((body) => setReels((body as unknown as { reels: ReelCard[] }).reels))
      .catch(() => setReels([]));
  }, []);

  // Nothing made yet: no empty section on the start page.
  if (reels && reels.length === 0) return null;

  return (
    <section className="mt-10" aria-label="Recent videos">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-950">Recent videos</h2>
        {reels && <span className="text-[12px] text-neutral-400">Swipe to see more</span>}
      </div>
      {/* Mobile: bleeds to the screen edges so the next card peeks. Desktop: stay in-column. */}
      <ul className="a2r-noscrollbar -mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 lg:mx-0 lg:scroll-px-0 lg:px-0">
        {!reels &&
          [0, 1, 2].map((i) => (
            <li key={i} className="w-[38%] shrink-0">
              <Skeleton className="aspect-[9/16] w-full rounded-2xl" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </li>
          ))}
        {reels?.map((r, i) => (
          <li key={r.id} className="a2r-rise w-[38%] shrink-0 snap-start" style={{ "--i": i } as CSSProperties}>
            <Link href={r.flow === "create" ? `/create/${r.id}` : `/jobs/${r.id}`} className="group block">
              <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-neutral-900 shadow-[0_12px_28px_-18px_rgba(0,0,0,0.45)] transition duration-300 group-hover:-translate-y-0.5 group-active:scale-[0.98]">
                {r.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Supabase links
                  <img src={r.thumbUrl} alt={r.hookTitle ?? r.title} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-b from-neutral-800 to-neutral-950 p-3 text-center text-[13px] font-extrabold uppercase leading-tight text-white">
                    {r.hookTitle ?? r.title.replace(/\.pdf$/i, "")}
                  </div>
                )}
                {r.durationS != null && (
                  <span className="absolute right-2 bottom-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
                    {Math.round(r.durationS)} s
                  </span>
                )}
              </div>
              <span className="mt-2 block truncate text-[13px] font-medium text-neutral-900">{r.hookTitle ?? r.title.replace(/\.pdf$/i, "")}</span>
              <span className="block text-[12px] text-neutral-400">{AUDIENCE_LABEL[audienceOf(r)]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
