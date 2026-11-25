import { supabaseAdmin } from "@/lib/supabase/server";
import {
  ESTIMATE_KEYS,
  movingAverage,
  phaseSeconds,
  wasCloudRendered,
  type EstimateKey,
} from "@/lib/create-estimates";
import type { Addons } from "@/lib/jobs";
import type { JobUsage } from "@/lib/pricing";
import type { StageTimes } from "@/lib/timing";

const SAMPLE = 5;
/** How many recent rendered jobs to scan so the video average can still find 5 cloud renders. */
const LOOKBACK = 80;

type Row = { stage_times: StageTimes | null; addons: Addons | null; usage: JobUsage | null };

/**
 * Moving-average durations (seconds) for automated /create steps.
 * Findings + script: last finished create-flow videos.
 * Video (render): only jobs that actually rendered on HeyGen Cloud
 * (`usage["render:cloud"]` or `addons.render === "cloud"`).
 */
export async function GET() {
  const supabase = supabaseAdmin();
  const latest = (flowOnly: boolean) => {
    let q = supabase
      .from("jobs")
      .select("stage_times, addons, usage")
      .eq("status", "rendered")
      .order("created_at", { ascending: false })
      .limit(LOOKBACK);
    if (flowOnly) q = q.eq("flow", "create");
    return q;
  };

  let { data, error } = await latest(true);
  // Before migration 0010 there is no flow column, or no create-flow videos yet: use any finished jobs.
  if ((error && /flow/.test(error.message)) || (!error && !(data ?? []).length)) {
    ({ data, error } = await latest(false));
  }
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  // Video estimate: also scan non-create rendered jobs if the create-flow pool has no cloud samples.
  let cloudRows = rows.filter((r) => wasCloudRendered(r.addons, r.usage));
  if (!cloudRows.some((r) => phaseSeconds(r.stage_times, "video") != null)) {
    const any = await supabase
      .from("jobs")
      .select("stage_times, addons, usage")
      .eq("status", "rendered")
      .order("created_at", { ascending: false })
      .limit(LOOKBACK);
    if (!any.error) {
      cloudRows = ((any.data ?? []) as Row[]).filter((r) => wasCloudRendered(r.addons, r.usage));
    }
  }

  const estimates = Object.fromEntries(
    ESTIMATE_KEYS.map((key: EstimateKey) => {
      const pool = key === "video" ? cloudRows : rows;
      return [
        key,
        movingAverage(
          pool.map((r) => phaseSeconds(r.stage_times, key)),
          SAMPLE,
        ),
      ];
    }),
  ) as Record<EstimateKey, number | null>;

  return Response.json({
    estimates,
    sample: SAMPLE,
    videoCloudSamples: Math.min(
      SAMPLE,
      cloudRows.filter((r) => phaseSeconds(r.stage_times, "video") != null).length,
    ),
  });
}
