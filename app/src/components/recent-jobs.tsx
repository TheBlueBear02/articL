"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { SETTLED_STATUSES, type JobStatus } from "@/lib/jobs";
import { STATUS_LABEL } from "./job-view";
import { formatDuration, jobTiming, type StageTimes } from "@/lib/timing";

type JobRow = {
  id: string;
  original_filename: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  total_duration_s: number | null;
  file_path: string;
  stage_times?: StageTimes | null;
};

const COLUMNS = "id, original_filename, status, created_at, updated_at, total_duration_s, file_path";
const LIMIT = 20;

/** Processing time for a finished or failed job ("made in 5m 12s"), from its stage times. */
function madeIn(j: JobRow): string | null {
  if (j.status !== "rendered" && j.status !== "failed") return null;
  const timing = jobTiming(j.stage_times, j.status, 0, j.file_path === "");
  return timing ? formatDuration(timing.processingSeconds) : null;
}
const REFRESH_MS = 10_000;
const STALE_MS = 30 * 60_000;

function statusStyle(status: JobStatus) {
  if (status === "rendered") return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (status === "failed") return "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
  if (status === "awaiting_selection") return "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200";
  return "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200";
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The most recent jobs, newest first, each linking to its own page. */
export function RecentJobs() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0); // when the list was fetched (keeps render pure)
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = (columns: string) =>
      supabaseBrowser()
        .from("jobs")
        .select(columns)
        .neq("status", "awaiting_upload") // abandoned uploads
        .order("created_at", { ascending: false })
        .limit(LIMIT);
    const load = async () => {
      let res = await query(`${COLUMNS}, stage_times`);
      // Before migration 0006 there is no stage_times column; show the list without timings.
      if (res.error && /stage_times/.test(res.error.message)) res = await query(COLUMNS);
      if (cancelled) return;
      if (res.error) setLoadError(res.error.message);
      else {
        setJobs(res.data as unknown as JobRow[]);
        setLoadedAt(Date.now());
      }
    };
    load();
    // Keep statuses fresh while something is still being made.
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // "In progress" = still working AND touched recently; older unfinished jobs are abandoned
  // (e.g. made before a later phase existed), not running.
  const working =
    jobs?.filter(
      (j) => !SETTLED_STATUSES.includes(j.status) && loadedAt - new Date(j.updated_at).getTime() < STALE_MS,
    ).length ?? 0;

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">My videos</h2>
        {working > 0 && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{working} in progress</span>
        )}
      </div>
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {jobs && jobs.length === 0 && (
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Nothing yet. Your videos will appear here.</p>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-300 dark:divide-neutral-800 dark:border-neutral-700">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={`/jobs/${j.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{j.original_filename}</span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                    {when(j.created_at)}
                    {j.status === "rendered" && j.total_duration_s != null && ` · ${Math.round(j.total_duration_s)} s video`}
                    {madeIn(j) && ` · ${j.status === "failed" ? "ran" : "made in"} ${madeIn(j)}`}
                  </span>
                </span>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${statusStyle(j.status)}`}>
                  {STATUS_LABEL[j.status].replace("…", "")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
