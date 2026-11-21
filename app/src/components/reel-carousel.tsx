"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { readJson } from "@/lib/api-client";
import { AUDIENCE_LABEL, audienceOf } from "@/lib/jobs";
import type { ReelCard } from "@/app/api/reels/route";

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The latest finished videos as reel-shaped cards in a sideways-scrolling row (swipe, trackpad or
 * the arrows). Running and failed jobs aren't shown. Loaded once per visit: no polling, and the
 * thumbnails are small JPEGs, so the home page costs little Supabase egress.
 */
export function ReelCarousel() {
  const [reels, setReels] = useState<ReelCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const track = useRef<HTMLUListElement>(null);

  useEffect(() => {
    fetch("/api/reels")
      .then(readJson)
      .then((body) => setReels((body as unknown as { reels: ReelCard[] }).reels))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Grey out an arrow at its end of the row.
  const updateEdges = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    updateEdges();
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [reels, updateEdges]);

  const page = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.9, behavior: "smooth" });

  const arrow = "flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-sm disabled:opacity-30 dark:border-neutral-700";

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My videos</h2>
        {reels && reels.length > 0 && (
          <div className="flex gap-2">
            <button type="button" aria-label="Previous videos" className={arrow} disabled={edges.start} onClick={() => page(-1)}>
              ←
            </button>
            <button type="button" aria-label="Next videos" className={arrow} disabled={edges.end} onClick={() => page(1)}>
              →
            </button>
          </div>
        )}
      </div>
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {reels && reels.length === 0 && (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Nothing yet. Your finished videos will appear here.</p>
      )}
      {reels && reels.length > 0 && (
        <ul
          ref={track}
          onScroll={updateEdges}
          className="mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {reels.map((r) => (
            // About 2 cards on a phone, 3 on a tablet, 5 on desktop.
            <li key={r.id} className="w-[42%] shrink-0 snap-start sm:w-[30%] lg:w-[calc((100%-4rem)/5)]">
              <Link href={`/jobs/${r.id}`} className="group block">
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-neutral-300 transition group-hover:ring-yellow-400 dark:ring-neutral-800">
                  {r.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed Supabase links; no image optimisation needed
                    <img src={r.thumbUrl} alt={r.hookTitle ?? r.title} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    // No thumbnail yet: the hook title on a plain card.
                    <div className="flex h-full items-center justify-center bg-gradient-to-b from-neutral-800 to-neutral-950 p-4 text-center text-sm font-extrabold uppercase leading-tight text-white">
                      {r.hookTitle ?? r.title.replace(/\.pdf$/i, "")}
                    </div>
                  )}
                  {r.durationS != null && (
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">
                      {Math.round(r.durationS)} s
                    </span>
                  )}
                </div>
                <span className="mt-2 block truncate text-sm font-medium">{r.title}</span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                  {AUDIENCE_LABEL[audienceOf(r)]} · {when(r.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
