"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { readJson } from "@/lib/api-client";
import type { Job } from "@/lib/jobs";

// Everything the flow shows, without the article text (~130 KB, never needed on screen).
const COLUMNS =
  "id, status, original_filename, file_path, audience, candidate_points, study_setting, selected_point_ids, script, segments, " +
  "total_duration_s, render_progress, video_path, addons, stage_times, error, created_at, updated_at, flow, audience_confirmed, " +
  "paper_meta, lead_point_id, hooks, chosen_hook, author_info, addons_confirmed_at, script_flags, block_thumbs, cover_segment, post_texts";

const DONE = new Set(["rendered", "failed"]);

/** Follow one job live (Realtime, plus a 3 s re-read as a safety net while it is still working). */
export function useJob(jobId: string) {
  const [job, setJob] = useState<Job | null>(null);
  const validId = /^[0-9a-f-]{36}$/i.test(jobId);
  const [notFound, setMissing] = useState(false);
  const missing = !validId || notFound;
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabaseBrowser().from("jobs").select(COLUMNS).eq("id", jobId).maybeSingle();
    if (error) {
      setLoadError(/column/i.test(error.message) ? "The database needs migration 0010 (supabase/migrations/0010_create_flow.sql)." : error.message);
      return;
    }
    if (!data) setMissing(true);
    else setJob((prev) => ({ ...prev, ...(data as unknown as Job) }));
  }, [jobId]);

  useEffect(() => {
    if (!validId) return;
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`create-${jobId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` }, (payload) => {
        // Large unchanged values can be left out of change events: merge, don't replace.
        const { extracted_text: _skip, ...rest } = payload.new as Partial<Job>;
        void _skip;
        setJob((prev) => ({ ...prev, ...rest }) as Job);
      })
      .subscribe((state) => {
        if (state === "SUBSCRIBED") void refresh();
      });
    // First read right away, not only once Realtime has subscribed.
    const first = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(first);
      supabase.removeChannel(channel);
    };
  }, [jobId, validId, refresh]);

  const done = job ? DONE.has(job.status) : false;
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [done, refresh]);

  /** Optimistic local change (the next read brings the saved row). */
  const patch = useCallback((fields: Partial<Job>) => setJob((prev) => (prev ? { ...prev, ...fields } : prev)), []);

  return { job, missing, loadError, refresh, patch };
}

/** POST JSON to one of the job's API routes; throws a readable error. */
export async function post<T = Record<string, unknown>>(jobId: string, path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`/api/jobs/${jobId}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await readJson(res)) as T;
}

/** Fire-and-forget analytics. */
export function track(jobId: string, name: string, data: Record<string, unknown> = {}) {
  void post(jobId, "events", { name, data }).catch(() => {});
}
