// Step timings for the job page, from jobs.stage_times (see 0006_stage_times.sql).
// Pure (type-only imports) so it can be tested with plain node.
import type { JobStatus } from "./jobs";

/** When the job first entered each status, plus "created". */
export type StageTimes = Partial<Record<JobStatus | "created", string>>;

/** Pipeline order; a step ends when the job reaches its end status OR any later one (steps can be skipped). */
const ORDER: (JobStatus | "created")[] = [
  "created",
  "awaiting_upload",
  "uploaded",
  "extracting",
  "extracted",
  "proposing",
  "awaiting_selection",
  "points_selected",
  "scripting",
  "voicing",
  "voiced",
  "fetching_broll",
  "rendering",
  "rendered",
];

type StepDef = { key: string; label: string; from: JobStatus | "created"; to: JobStatus; user?: boolean };

export const STEP_DEFS: StepDef[] = [
  { key: "upload", label: "Upload", from: "created", to: "uploaded" },
  { key: "read", label: "Read the PDF", from: "uploaded", to: "proposing" },
  { key: "points", label: "Find points", from: "proposing", to: "awaiting_selection" },
  { key: "choice", label: "Your choice", from: "awaiting_selection", to: "points_selected", user: true },
  { key: "script", label: "Write script", from: "points_selected", to: "voicing" },
  { key: "voice", label: "Record voice", from: "voicing", to: "fetching_broll" },
  { key: "footage", label: "Find footage", from: "fetching_broll", to: "rendering" },
  { key: "render", label: "Render + save", from: "rendering", to: "rendered" },
];

export type StepTiming = {
  key: string;
  label: string;
  /** Waiting on the user, not the machine: not counted in processing time. */
  user: boolean;
  state: "done" | "running" | "failed" | "pending" | "skipped";
  /** Seconds; for a running step, so far. */
  seconds: number | null;
};

export type JobTiming = {
  steps: StepTiming[];
  /** Machine time: all steps except the user's choice. */
  processingSeconds: number;
  /** Created to finished (or to now, if still going), including the user's choice. */
  wallSeconds: number;
  running: boolean;
};

const t = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

/**
 * Durations per step. `now` is passed in (ms) so the caller controls the clock.
 * pastedText: jobs made from pasted text skip the upload and PDF-reading steps.
 */
export function jobTiming(
  times: StageTimes | null | undefined,
  status: JobStatus,
  now: number,
  pastedText = false,
): JobTiming | null {
  if (!times || !times.created) return null;
  const failedAt = t(times.failed);
  const settled = status === "rendered" || status === "failed";

  // Earliest time the job reached `status` or any status after it.
  const reached = (s: JobStatus | "created") => {
    const from = ORDER.indexOf(s);
    const hits = ORDER.slice(from)
      .map((x) => t(times[x]))
      .filter((n) => Number.isFinite(n));
    return hits.length ? Math.min(...hits) : NaN;
  };

  let failureAssigned = false;
  const steps: StepTiming[] = STEP_DEFS.map((d) => {
    const base = { key: d.key, label: d.label, user: !!d.user };
    if (pastedText && (d.key === "upload" || d.key === "read")) return { ...base, state: "skipped", seconds: null };
    const start = d.from === "created" ? t(times.created) : reached(d.from);
    const end = reached(d.to);
    if (!Number.isFinite(start)) return { ...base, state: "pending", seconds: null };
    if (Number.isFinite(end)) return { ...base, state: "done", seconds: Math.max(0, (end - start) / 1000) };
    // Started, not finished: it's the step that failed, or the one running now.
    if (Number.isFinite(failedAt) && !failureAssigned) {
      failureAssigned = true;
      return { ...base, state: "failed", seconds: Math.max(0, (failedAt - start) / 1000) };
    }
    if (status === "failed") return { ...base, state: "pending", seconds: null };
    return { ...base, state: "running", seconds: Math.max(0, (now - start) / 1000) };
  });

  const processingSeconds = steps.filter((s) => !s.user).reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  const endAt = status === "rendered" ? t(times.rendered) : status === "failed" ? failedAt : now;
  return {
    steps,
    processingSeconds,
    wallSeconds: Math.max(0, ((Number.isFinite(endAt) ? endAt : now) - t(times.created)) / 1000),
    // Includes waiting for the user's choice, so that step's clock ticks too.
    running: !settled,
  };
}

/** 4.2 -> "4.2s", 75 -> "1m 15s", 3725 -> "1h 2m". */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
