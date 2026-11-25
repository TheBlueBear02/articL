import { supabaseAdmin } from "@/lib/supabase/server";
import { ESTIMATE_KEYS, movingAverage, phaseSeconds, type EstimateKey } from "@/lib/create-estimates";
import type { StageTimes } from "@/lib/timing";

const SAMPLE = 5;

/**
 * Moving-average durations (seconds) for automated /create steps, from the last 5 finished
 * create-flow videos that completed each phase.
 */
export async function GET() {
  const supabase = supabaseAdmin();
  const latest = (flowOnly: boolean) => {
    let q = supabase.from("jobs").select("stage_times").eq("status", "rendered").order("created_at", { ascending: false }).limit(SAMPLE);
    if (flowOnly) q = q.eq("flow", "create");
    return q;
  };

  let { data, error } = await latest(true);
  // Before migration 0010 there is no flow column, or no create-flow videos yet: use any finished jobs.
  if ((error && /flow/.test(error.message)) || (!error && !(data ?? []).length)) {
    ({ data, error } = await latest(false));
  }
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { stage_times: StageTimes | null }[];
  const estimates = Object.fromEntries(
    ESTIMATE_KEYS.map((key: EstimateKey) => [
      key,
      movingAverage(
        rows.map((r) => phaseSeconds(r.stage_times, key)),
        SAMPLE,
      ),
    ]),
  ) as Record<EstimateKey, number | null>;

  return Response.json({ estimates, sample: SAMPLE });
}
