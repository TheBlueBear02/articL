"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { readJson } from "@/lib/api-client";
import { formatDuration, jobTiming } from "@/lib/timing";
import { formatCost, formatUsage, usageByStep } from "@/lib/pricing";
import {
  SETTLED_STATUSES,
  type CandidatePoint,
  type Job,
  type JobStatus,
  MUSIC_MOODS,
  SPLIT_STYLES,
  type Addons,
  type LibraryInfo,
  type MusicMood,
  type SplitStyle,
  type Script,
  type Segment,
  AUDIENCE_LABEL,
  audienceOf,
  STATUS_LABEL,
  DEFAULT_ADDONS,
  resolveAddons,
} from "@/lib/jobs";
import { JobMediaPanel, ReelPanel } from "@/components/job-media-panel";

export type JobViewMode = "production" | "test";

/** Re-export for older imports. */
export { STATUS_LABEL };

/** Reading the article and finding points: add-ons can be chosen meanwhile. */
const EARLY_STATUSES: JobStatus[] = ["awaiting_upload", "uploaded", "extracting", "extracted", "proposing", "awaiting_selection"];

const IN_PRODUCTION: JobStatus[] = ["points_selected", "scripting", "voicing", "voiced", "fetching_broll", "rendering"];

type ProgressStep = { key: string; label: string };

/** Full pipeline shown in Production: early article steps, then video production. */
const PROGRESS_STEPS: ProgressStep[] = [
  { key: "upload", label: "Upload" },
  { key: "read", label: "Read article" },
  { key: "points", label: "Find points" },
  { key: "script", label: "Write script" },
  { key: "voice", label: "Record voice" },
  { key: "footage", label: "Find visual materials" },
  { key: "render", label: "Render video" },
];

/** Index of the step that is currently running (or next to start). */
const STEP_OF: Partial<Record<JobStatus, number>> = {
  awaiting_upload: 0,
  uploaded: 1,
  extracting: 1,
  extracted: 1,
  proposing: 2,
  awaiting_selection: 3,
  points_selected: 3,
  scripting: 3,
  voicing: 4,
  voiced: 5,
  fetching_broll: 5,
  rendering: 6,
  rendered: 7,
};

/** One row per pipeline step: green when done, in-row progress bar while that step runs. */
function ProgressSteps({
  status,
  renderProgress,
  pastedText,
}: {
  status: JobStatus;
  renderProgress: number | null;
  /** Pasted-text jobs have no PDF upload/read. */
  pastedText?: boolean;
}) {
  const steps = pastedText
    ? PROGRESS_STEPS.filter((s) => s.key !== "upload").map((s) =>
        s.key === "read" ? { ...s, label: "Prepare text" } : s,
      )
    : PROGRESS_STEPS;
  // Pasted jobs drop "upload", so indices after it shift by -1 vs STEP_OF.
  const raw = STEP_OF[status] ?? 0;
  const current = pastedText ? Math.max(0, raw - 1) : raw;
  const failed = status === "failed";

  return (
    <ol className="mt-3 space-y-2">
      {steps.map((step, i) => {
        const done = current > i;
        const active = !failed && current === i;
        const pct =
          active && status === "rendering" ? Math.min(100, Math.max(0, renderProgress ?? 0)) : active ? null : done ? 100 : 0;

        return (
          <li
            key={step.key}
            className="min-w-0 rounded-lg border border-neutral-300 px-3 py-3 dark:border-neutral-700"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span
                className={`truncate text-sm font-medium ${
                  done
                    ? "text-emerald-700 dark:text-emerald-300"
                    : active
                      ? "text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-400 dark:text-neutral-500"
                }`}
              >
                {step.label}
              </span>
              {done ? (
                <span className="shrink-0 text-sm font-medium text-emerald-700 dark:text-emerald-300" aria-label="Done">
                  ✓
                </span>
              ) : active && status === "rendering" ? (
                <span className="shrink-0 text-xs tabular-nums text-neutral-500">{pct}%</span>
              ) : null}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              {done ? (
                <div className="h-full w-full rounded-full bg-emerald-500" />
              ) : active && status === "rendering" ? (
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
                  style={{ width: `${pct}%` }}
                />
              ) : active ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const SEGMENT_LABEL: Record<Segment["kind"], string> = { hook: "Hook", beat: "Beat", closing: "Closing" };

function VoiceoverPanel({
  jobId,
  segments,
  total,
  script,
}: {
  jobId: string;
  segments: Segment[];
  total: number | null;
  script: Script | null;
}) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/audio`)
      .then(readJson)
      .then((body) => setUrls(body.urls as string[]))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [jobId]);

  // Play every segment back to back, as the finished video will.
  async function playAll() {
    setPlayingAll(true);
    try {
      for (const el of audioRefs.current) {
        if (!el) continue;
        el.currentTime = 0;
        await el.play();
        await new Promise<void>((resolve) => el.addEventListener("ended", () => resolve(), { once: true }));
      }
    } finally {
      setPlayingAll(false);
    }
  }

  function stopAll() {
    audioRefs.current.forEach((el) => el?.pause());
    setPlayingAll(false);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Script and voiceover</h2>
        {total != null && <span className="text-sm text-neutral-600 dark:text-neutral-400">{total.toFixed(1)} s total</span>}
      </div>
      <button
        onClick={playingAll ? stopAll : playAll}
        disabled={!urls}
        className="mt-3 rounded-md bg-brand px-5 py-2 font-semibold text-neutral-900 disabled:opacity-40"
      >
        {playingAll ? "Stop" : "▶ Play all"}
      </button>
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {(script?.hookTitle || script?.sourceCredit) && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {script.hookTitle && (
            <>
              <dt className="text-neutral-500 dark:text-neutral-400">On-screen title</dt>
              <dd className="font-semibold uppercase">{script.hookTitle}</dd>
            </>
          )}
          {script.sourceCredit && (
            <>
              <dt className="text-neutral-500 dark:text-neutral-400">Source credit</dt>
              <dd>{script.sourceCredit}</dd>
            </>
          )}
        </dl>
      )}
      <ol className="mt-4 space-y-3">
        {segments.map((s, i) => (
          <li key={s.audioPath} className="rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
              <span className="font-semibold uppercase tracking-wide">
                {SEGMENT_LABEL[s.kind]}
                {s.kind === "beat" && s.pointId && s.pointId === script?.payoffPointId && " · payoff"}
              </span>
              <span>
                {s.duration.toFixed(1)} s · b-roll: “{s.broll}”{s.popup && ` · pop-up: “${s.popup.word}”`}
              </span>
            </div>
            <p className="mt-1 text-sm">{s.text}</p>
            {urls?.[i] && (
              <audio
                ref={(el) => {
                  audioRefs.current[i] = el;
                }}
                src={urls[i]}
                controls
                preload="none"
                className="mt-2 h-8 w-full"
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

const MUSIC_LABEL: Record<MusicMood, string> = { calm: "Calm", upbeat: "Upbeat", dramatic: "Dramatic" };
const SPLIT_LABEL: Record<SplitStyle, string> = { gameplay: "Gameplay", satisfying: "Satisfying clips" };

/** Optional extras. Compact layout for the controls column; choices without library files are disabled. */
function AddonsPicker({
  value,
  onChange,
  title = "Add-ons",
  children,
}: {
  value: Addons;
  onChange: (a: Addons) => void;
  title?: string;
  children?: ReactNode;
}) {
  const [lib, setLib] = useState<LibraryInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/library")
      .then(readJson)
      .then((body) => setLib(body as unknown as LibraryInfo))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const btn = (on: boolean, disabled: boolean) =>
    `min-w-0 rounded-sm border px-1.5 py-2 text-center text-xs leading-tight ${
      on ? "border-brand bg-brand font-semibold text-neutral-900" : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950"
    } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`;

  const rowStyle = (count: number): CSSProperties => ({
    gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
  });

  return (
    <div className="min-h-0">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {loadError && <p className="mt-1 text-xs text-red-600">Couldn&apos;t load the library: {loadError}</p>}

      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">Background music</p>
      <div className="mt-1 grid gap-1.5" style={rowStyle(1 + MUSIC_MOODS.length)}>
        <button type="button" className={btn(!value.music, false)} onClick={() => onChange({ ...value, music: undefined })}>
          Off
        </button>
        {MUSIC_MOODS.map((m) => {
          const disabled = !lib?.music[m];
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              title={disabled ? "No tracks for this mood in the library yet" : undefined}
              className={btn(value.music === m, disabled)}
              onClick={() => onChange({ ...value, music: m })}
            >
              {MUSIC_LABEL[m]}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">Split screen</p>
      <div className="mt-1 grid gap-1.5" style={rowStyle(1 + SPLIT_STYLES.length)}>
        <button
          type="button"
          className={btn(!value.split, false)}
          onClick={() => onChange({ ...value, split: undefined, gameplayClip: undefined })}
        >
          Off
        </button>
        {SPLIT_STYLES.map((s) => {
          const disabled = s === "gameplay" && !lib?.gameplay;
          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              title={disabled ? "No gameplay clips in the library yet" : undefined}
              className={btn(value.split === s, disabled)}
              onClick={() => onChange({ ...value, split: s, gameplayClip: s === "gameplay" ? value.gameplayClip : undefined })}
            >
              {SPLIT_LABEL[s]}
            </button>
          );
        })}
      </div>

      {value.split === "gameplay" && lib && lib.gameplayClips.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...value, gameplayClip: undefined })}
            className={`flex aspect-video items-center justify-center rounded-md border px-1 text-center text-[10px] leading-tight ${
              !value.gameplayClip
                ? "border-brand bg-brand/20 font-semibold"
                : "border-neutral-300 dark:border-neutral-700"
            }`}
          >
            Any
          </button>
          {lib.gameplayClips.map((c) => {
            const on = value.gameplayClip === c.path;
            return (
              <button
                key={c.path}
                type="button"
                title={c.name}
                onClick={() => onChange({ ...value, gameplayClip: c.path })}
                className={`overflow-hidden rounded-md border text-left ${
                  on ? "border-brand" : "border-neutral-300 dark:border-neutral-700"
                }`}
              >
                {c.previewUrl ? (
                  <video
                    // "#t=3" shows a frame from the action instead of a black first frame.
                    src={`${c.previewUrl}#t=3`}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                    onMouseLeave={(e) => e.currentTarget.pause()}
                    className="aspect-video w-full bg-black object-cover"
                  />
                ) : (
                  <div className="aspect-video w-full bg-neutral-200 dark:bg-neutral-800" />
                )}
                <span className={`block truncate px-1 py-0.5 text-[10px] leading-tight ${on ? "font-semibold" : ""}`}>
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">Pop-up images</p>
      <div className="mt-1 grid gap-1.5" style={rowStyle(2)}>
        <button type="button" className={btn(value.popups !== false, false)} onClick={() => onChange({ ...value, popups: true })}>
          On
        </button>
        <button type="button" className={btn(value.popups === false, false)} onClick={() => onChange({ ...value, popups: false })}>
          Off
        </button>
      </div>

      {(
        [
          ["sfx", "Sound effects"],
          ["map", "Map intro"],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">{label}</p>
          <div className="mt-1 grid gap-1.5" style={rowStyle(2)}>
            <button type="button" className={btn(value[key] !== false, false)} onClick={() => onChange({ ...value, [key]: true })}>
              On
            </button>
            <button type="button" className={btn(value[key] === false, false)} onClick={() => onChange({ ...value, [key]: false })}>
              Off
            </button>
          </div>
        </div>
      ))}
      {children}
    </div>
  );
}

type AddonControls = {
  value: Addons;
  onChange: (a: Addons) => void;
  saveState: "idle" | "saving" | "saved";
  onSave: () => void;
};

/** Middle column: add-ons (early statuses) and/or auto-chosen points while producing. */
function JobControlsColumn({
  addons,
  pointsSection,
}: {
  addons?: AddonControls;
  pointsSection?: ReactNode;
}) {
  if (!addons && !pointsSection) return null;

  return (
    <aside className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/50 lg:min-h-[32rem]">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        {addons && (
          <AddonsPicker value={addons.value} onChange={addons.onChange} title="While you wait: add-ons">
            <div className="mt-4">
              <button
                type="button"
                onClick={addons.onSave}
                disabled={addons.saveState !== "idle"}
                className="w-full rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-neutral-900 disabled:opacity-40"
              >
                {addons.saveState === "saving" ? "Saving…" : addons.saveState === "saved" ? "Saved" : "Save add-ons"}
              </button>
              <p className="mt-1.5 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
                {addons.saveState === "saved"
                  ? "Saved. Points are chosen automatically when ready."
                  : "Saved with your choices if you leave this page."}
              </p>
            </div>
          </AddonsPicker>
        )}
        {pointsSection}
      </div>
    </aside>
  );
}

/** Start-to-finish timer plus each step's duration, tokens and cost — left sidebar in Test view. */
function TimingSidebar({ job }: { job: Job }) {
  const [now, setNow] = useState<number | null>(null);
  const live = !["rendered", "failed"].includes(job.status);

  // Tick once a second while the job is still going (the clock is read in an effect, not during render).
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    if (!live) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live]);

  const timing = now === null ? null : jobTiming(job.stage_times, job.status, now, job.file_path === "");
  const usage = usageByStep(job.usage);
  const costs = Object.values(usage).map((u) => u.cost);
  const totalCost = costs.length && costs.every((c) => c !== null) ? costs.reduce((a, b) => a! + b!, 0) : null;

  return (
    <aside className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900/50 lg:min-h-[32rem]">
      <h2 className="shrink-0 text-sm font-semibold tracking-tight">Steps &amp; cost</h2>
      {timing ? (
        <>
          <p className="mt-1 shrink-0 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            {formatDuration(timing.processingSeconds)} processing
            <span className="text-neutral-400"> · </span>
            {formatDuration(timing.wallSeconds)} total
            {totalCost !== null && (
              <>
                <span className="text-neutral-400"> · </span>~{formatCost(totalCost)} OpenAI (est.)
              </>
            )}
          </p>
          <ol className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
            {timing.steps.map((s) => {
              const done = s.state === "done";
              const active = s.state === "running";
              const failed = s.state === "failed";
              const muted = s.user || s.state === "skipped";
              const renderPct =
                active && s.key === "render" && job.render_progress != null
                  ? Math.min(100, Math.max(0, job.render_progress))
                  : null;

              return (
                <li
                  key={s.key}
                  className={`min-w-0 rounded-lg border border-neutral-300 px-3 py-3 dark:border-neutral-700 ${
                    muted ? "opacity-70" : ""
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span
                      className={`min-w-0 truncate text-sm font-medium ${
                        done
                          ? "text-emerald-700 dark:text-emerald-300"
                          : failed
                            ? "text-red-600"
                            : active
                              ? "text-neutral-900 dark:text-neutral-100"
                              : "text-neutral-400 dark:text-neutral-500"
                      }`}
                    >
                      {s.label}
                      {s.user && <span className="font-normal text-neutral-500"> (not counted)</span>}
                      {s.state === "skipped" && <span className="font-normal text-neutral-500"> (pasted text)</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {s.state !== "skipped" && s.seconds != null && (
                        <span className={`text-xs tabular-nums ${active ? "font-semibold" : "text-neutral-500"}`}>
                          {formatDuration(s.seconds)}
                        </span>
                      )}
                      {renderPct != null && (
                        <span className="text-xs tabular-nums text-neutral-500">{renderPct}%</span>
                      )}
                      {done && (
                        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300" aria-label="Done">
                          ✓
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    {done ? (
                      <div className="h-full w-full rounded-full bg-emerald-500" />
                    ) : failed ? (
                      <div className="h-full w-full rounded-full bg-red-500" />
                    ) : active && renderPct != null ? (
                      <div
                        className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
                        style={{ width: `${renderPct}%` }}
                      />
                    ) : active ? (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
                    ) : null}
                  </div>
                  {(failed || usage[s.key]) && (
                    <p className="mt-1.5 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
                      {failed && <span className="text-red-600">failed here </span>}
                      {usage[s.key] && (
                        <span
                          className="tabular-nums"
                          title={
                            usage[s.key].tokens
                              ? `${usage[s.key].tokens!.model}; ${usage[s.key].tokens!.reasoning.toLocaleString("en-US")} of the output tokens were reasoning`
                              : undefined
                          }
                        >
                          {formatUsage(usage[s.key])}
                          {usage[s.key].cost !== null && ` · ~${formatCost(usage[s.key].cost)}`}
                        </span>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="mt-2 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">Waiting for step times…</p>
      )}
    </aside>
  );
}

/** Production left column: status and progress without timing, tokens or cost. */
function ProductionSidebar({ job }: { job: Job }) {
  const showProgress = job.status !== "failed" || (job.stage_times != null && Object.keys(job.stage_times).length > 0);

  return (
    <aside className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/50 lg:min-h-[32rem]">
      <h2 className="shrink-0 text-sm font-semibold tracking-tight">Progress</h2>
      <p className={`mt-1 shrink-0 text-xs ${job.status === "failed" ? "text-red-600" : "text-neutral-500 dark:text-neutral-400"}`}>
        {STATUS_LABEL[job.status]}
      </p>
      {showProgress && (
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          <ProgressSteps
            status={job.status}
            renderProgress={job.render_progress}
            pastedText={job.file_path === ""}
          />
        </div>
      )}
      {job.status === "rendered" && (
        <p className="mt-3 shrink-0 text-sm font-medium text-emerald-700 dark:text-emerald-300">Your reel is ready.</p>
      )}
    </aside>
  );
}

/** Every job column the page uses except the article text, which is large (~130 KB) and only shown on request. */
const JOB_COLUMNS =
  "id, status, original_filename, file_path, page_count, word_count, candidate_points, study_setting, audience, " +
  "selected_point_ids, selected_at, script, segments, total_duration_s, broll, render_progress, video_path, addons, " +
  "addon_media, stage_times, usage, error, created_at, updated_at";

/**
 * Read the job row without the article text. Polled every 3 s while a job works, so this is most
 * of the page's database egress: the full row was ~166 KB, 132 KB of it the text. Falls back to
 * all columns on a database missing a newer column (before migrations 0006-0008).
 */
async function readJobRow(jobId: string): Promise<{ data: Partial<Job> | null; error: { message: string } | null }> {
  const q = async (columns: string) => {
    const { data, error } = await supabaseBrowser().from("jobs").select(columns).eq("id", jobId).maybeSingle();
    return { data: data as Partial<Job> | null, error };
  };
  const res = await q(JOB_COLUMNS);
  return res.error && /column/i.test(res.error.message) ? q("*") : res;
}

/** Everything about one job: live status, auto-chosen points, progress, voiceover and video. */
export function JobView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<JobViewMode>("production");
  // Pop-up images, sound effects and the map intro are on by default.
  const [addons, setAddonsState] = useState<Addons>(DEFAULT_ADDONS);
  // Add-ons can be chosen and saved while the article is read; "saved" until changed again.
  const [addonsSave, setAddonsSave] = useState<"idle" | "saving" | "saved">("idle");
  const [addonsLoaded, setAddonsLoaded] = useState(false);
  const autoSelectStarted = useRef(false);
  function setAddons(a: Addons) {
    setAddonsState(resolveAddons(a));
    setAddonsSave("idle");
  }
  // Start from choices saved earlier (e.g. after a refresh), once, when the job first loads.
  if (job && !addonsLoaded) {
    setAddonsLoaded(true);
    if (EARLY_STATUSES.includes(job.status)) {
      setAddonsState(resolveAddons(job.addons));
      if (job.addons) setAddonsSave("saved");
    }
  }

  async function saveAddons() {
    setAddonsSave("saving");
    setError(null);
    try {
      await readJson(
        await fetch(`/api/jobs/${jobId}/addons`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addons }),
        }),
      );
      setAddonsSave("saved");
    } catch (e) {
      setAddonsSave("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const settled = job ? SETTLED_STATUSES.includes(job.status) : false;
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId);

  // Safety net: Realtime can miss updates (e.g. while it warms up on a fresh project), so
  // re-read the row every few seconds whenever the job is still working.
  useEffect(() => {
    if (!validId || settled) return;
    const poll = setInterval(() => {
      readJobRow(jobId).then(({ data }) => data && setJob((prev) => ({ ...prev, ...data }) as Job));
    }, 3000);
    return () => clearInterval(poll);
  }, [jobId, validId, settled]);

  // Follow the job row live once we have an id.
  useEffect(() => {
    const supabase = supabaseBrowser();

    const refresh = () =>
      readJobRow(jobId).then(({ data, error }) => {
        if (data) setJob((prev) => ({ ...prev, ...data }) as Job);
        else if (!error) setNotFound(true); // also covers ids that aren't valid UUIDs below
      });

    // A malformed id can't match any job; skip the query (Postgres would reject it).
    if (!validId) return;

    const channel = supabase
      .channel(`job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
        // Merge rather than replace: Postgres leaves large unchanged values (like
        // extracted_text) out of change events, so payload.new can be partial.
        (payload) => setJob((prev) => ({ ...prev, ...(payload.new as Partial<Job>) }) as Job),
      )
      .subscribe((state) => {
        // Read the current row once subscribed, so no update between upload and subscribe is missed.
        if (state === "SUBSCRIBED") refresh();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, validId]);

  // Recovery: jobs created before auto-select may still sit on awaiting_selection — continue them.
  useEffect(() => {
    if (!job || job.status !== "awaiting_selection" || autoSelectStarted.current) return;
    const points = job.candidate_points ?? [];
    const pointIds = points.filter((p) => p.recommended).map((p) => p.id);
    if (!pointIds.length) return;
    autoSelectStarted.current = true;
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pointIds, addons: resolveAddons(job.addons ?? addons) }),
        });
        const body = (await readJson(res)) as { selected: string[] };
        setJob((j) => (j ? { ...j, status: "points_selected", selected_point_ids: body.selected } : j));
      } catch (e) {
        autoSelectStarted.current = false;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [job, jobId, addons]);

  const points: CandidatePoint[] = job?.candidate_points ?? [];
  const chosen = points.filter((p) => job?.selected_point_ids?.includes(p.id));

  if (notFound || !validId) return <p className="mt-8 text-sm text-red-600">This job doesn&apos;t exist (or was deleted).</p>;
  if (!job) return <p className="mt-8 text-sm text-neutral-500">Loading…</p>;

  const isTest = viewMode === "test";
  const reelReady = job.status === "rendered";
  const addonControls: AddonControls | undefined = EARLY_STATUSES.includes(job.status)
    ? {
        value: addons,
        onChange: setAddons,
        saveState: addonsSave,
        onSave: () => void saveAddons(),
      }
    : undefined;

  const pointsSection = IN_PRODUCTION.includes(job.status) ? (
    <div>
      <h2 className="text-sm font-semibold tracking-tight">{STATUS_LABEL[job.status]}</h2>
      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">Points for this video:</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
        {chosen.map((p) => (
          <li key={p.id}>{p.text}</li>
        ))}
      </ol>
    </div>
  ) : undefined;

  const showControls = !reelReady && Boolean(addonControls || pointsSection);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{job.original_filename}</span>
          {" · "}
          {AUDIENCE_LABEL[audienceOf(job)]} video
          <span className={job.status === "failed" ? " text-red-600" : ""}> · {STATUS_LABEL[job.status]}</span>
        </p>
        <div role="tablist" aria-label="View mode" className="inline-flex rounded-lg bg-neutral-100 p-1 text-xs dark:bg-neutral-900">
          {(
            [
              ["production", "Production"],
              ["test", "Test"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={viewMode === value}
              onClick={() => setViewMode(value)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                viewMode === value
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {job.error && <p className="mt-2 text-sm text-red-600">{job.error}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div
        className={`mt-4 grid gap-4 lg:items-stretch lg:gap-6 ${
          reelReady
            ? "lg:grid-cols-[17.5rem_minmax(0,1fr)_auto]"
            : showControls
              ? "lg:grid-cols-[17.5rem_minmax(18rem,24rem)_minmax(0,1fr)]"
              : "lg:grid-cols-[17.5rem_minmax(0,1fr)]"
        }`}
      >
        {isTest ? <TimingSidebar job={job} /> : <ProductionSidebar job={job} />}

        {showControls && <JobControlsColumn addons={addonControls} pointsSection={pointsSection} />}

        <JobMediaPanel
          jobId={job.id}
          filename={job.original_filename}
          status={job.status}
          filePath={job.file_path}
          wordCount={job.word_count}
        />

        {reelReady && <ReelPanel jobId={job.id} />}
      </div>

      {/* Script/voiceover details stay in Test view; Production focuses on article + reel. */}
      {isTest && job.segments && ["voiced", "fetching_broll", "rendering", "rendered"].includes(job.status) && (
        <VoiceoverPanel jobId={job.id} segments={job.segments} total={job.total_duration_s} script={job.script} />
      )}
    </section>
  );
}
