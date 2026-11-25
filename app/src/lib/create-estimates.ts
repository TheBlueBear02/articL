import type { JobStatus } from "./jobs";
import type { StageTimes } from "./timing";

/** Automated create-flow phases that show a moving-average estimate in the step rail. */
export type EstimateKey = "findings" | "script" | "video";

/**
 * Which stage_times keys bound each automated phase.
 * Start = earliest present "from" timestamp; end = "to" timestamp.
 */
const WINDOWS: Record<EstimateKey, { from: (JobStatus | "created")[]; to: JobStatus }> = {
  // PDF read + point finding, until the findings screen is ready.
  findings: { from: ["extracting", "uploaded", "proposing"], to: "awaiting_findings" },
  // Script + voice, until the review screen is ready.
  script: { from: ["scripting", "points_selected"], to: "awaiting_review" },
  // B-roll + render, until the video is ready.
  video: { from: ["fetching_broll", "rendering"], to: "rendered" },
};

export const ESTIMATE_KEYS = Object.keys(WINDOWS) as EstimateKey[];

/** Seconds for one phase on one job, or null when that phase didn't complete. */
export function phaseSeconds(times: StageTimes | null | undefined, key: EstimateKey): number | null {
  if (!times) return null;
  const { from, to } = WINDOWS[key];
  const starts = from.map((k) => Date.parse(times[k] ?? "")).filter((n) => Number.isFinite(n));
  const end = Date.parse(times[to] ?? "");
  if (!starts.length || !Number.isFinite(end)) return null;
  const start = Math.min(...starts);
  if (end < start) return null;
  return (end - start) / 1000;
}

/** Mean of the last up-to-N finite samples (caller passes newest-first durations). */
export function movingAverage(samples: (number | null)[], n = 5): number | null {
  const vals = samples.filter((s): s is number => s != null && Number.isFinite(s)).slice(0, n);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Compact estimate label: "~45s", "~1m", "~2m 10s". */
export function formatEstimate(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 10) return `~${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (s === 0) return `~${m}m`;
  if (m < 10) return `~${m}m ${String(s).padStart(2, "0")}s`;
  return `~${m}m`;
}
