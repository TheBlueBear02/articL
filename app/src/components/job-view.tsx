"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { readJson } from "@/lib/api-client";
import { formatDuration, jobTiming, type StepTiming } from "@/lib/timing";
import {
  MAX_SELECTED_POINTS,
  SETTLED_STATUSES,
  type CandidatePoint,
  type Job,
  type JobStatus,
  type PointType,
  MUSIC_MOODS,
  SPLIT_STYLES,
  type Addons,
  type AddonMedia,
  type LibraryInfo,
  type MusicMood,
  type SplitStyle,
  type Script,
  type Segment,
  type BrollImage,
} from "@/lib/jobs";

export const STATUS_LABEL: Record<JobStatus, string> = {
  awaiting_upload: "Uploading…",
  uploaded: "Uploaded, waiting to start…",
  extracting: "Extracting text…",
  extracted: "Text extracted",
  proposing: "Finding key points…",
  awaiting_selection: "Pick up to 5 points",
  points_selected: "Points saved",
  scripting: "Writing the script…",
  voicing: "Recording the voiceover…",
  voiced: "Voiceover ready",
  fetching_broll: "Finding b-roll images…",
  rendering: "Rendering the video…",
  rendered: "Video ready",
  failed: "Failed",
};

const IN_PRODUCTION: JobStatus[] = ["points_selected", "scripting", "voicing", "voiced", "fetching_broll", "rendering"];

const TYPE_STYLE: Record<PointType, string> = {
  stat: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  quote: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  claim: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
};

function TypeBadge({ type }: { type: PointType }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${TYPE_STYLE[type]}`}>
      {type}
    </span>
  );
}

const STEPS = ["Write script", "Record voice", "Find b-roll", "Render video"];
const STEP_OF: Partial<Record<JobStatus, number>> = {
  points_selected: 0,
  scripting: 0,
  voicing: 1,
  voiced: 2,
  fetching_broll: 2,
  rendering: 3,
};

function ProgressSteps({ status, renderProgress }: { status: JobStatus; renderProgress: number | null }) {
  const current = STEP_OF[status] ?? 0;
  return (
    <div>
      <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {STEPS.map((label, i) => (
          <li key={label} className={i === current ? "font-semibold" : i < current ? "text-emerald-600" : "text-neutral-400"}>
            {i < current ? "✓ " : i === current ? "● " : "○ "}
            {label}
          </li>
        ))}
      </ol>
      {status === "rendering" && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full bg-yellow-400 transition-all" style={{ width: `${renderProgress ?? 0}%` }} />
          </div>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {renderProgress ?? 0}% · rendering on this computer usually takes about 4 minutes
          </p>
        </div>
      )}
    </div>
  );
}

/** Text to paste under the video when posting, with a copy button. */
function PostCaption({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mt-5 max-w-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Post caption</h3>
        <button onClick={copy} className="rounded-md border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-700">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{text}</p>
    </div>
  );
}

function VideoPanel({
  jobId,
  broll,
  postCaption,
  addonMedia,
}: {
  jobId: string;
  broll: BrollImage[] | null;
  postCaption?: string;
  addonMedia?: AddonMedia | null;
}) {
  // Top-half footage plus any Pixabay clips in the split screen's bottom half.
  const credits = [
    ...(broll ?? []).map((b) => ({ user: b.user, pageURL: b.pageURL, pixabayId: b.pixabayId })),
    ...(addonMedia?.bottom ?? [])
      .filter((c) => c.source === "pixabay" && c.user && c.pageURL)
      .map((c) => ({ user: c.user!, pageURL: c.pageURL!, pixabayId: c.pixabayId ?? 0 })),
  ];
  const [links, setLinks] = useState<{ url: string; downloadUrl: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/video`)
      .then(readJson)
      .then((body) => setLinks(body as unknown as { url: string; downloadUrl: string }))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [jobId]);

  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold">Your reel</h2>
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {links && (
        <>
          <video
            // Loops like Reels/TikTok do, to check the seamless ending. No "#t=0.5" start offset: the
            // opening frame (hook title) is a fine preview, and an offset would skip it on every replay.
            src={links.url}
            controls
            loop
            playsInline
            preload="auto"
            className="mt-3 aspect-[9/16] w-full max-w-sm rounded-lg bg-black"
          />
          <a
            href={links.downloadUrl}
            className="mt-3 inline-block rounded-md bg-yellow-400 px-5 py-2 font-semibold text-neutral-900"
          >
            Download MP4
          </a>
        </>
      )}
      {postCaption && <PostCaption text={postCaption} />}
      {credits.length > 0 && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          Footage from Pixabay:{" "}
          {/* One credit per creator; each links to one of their clips or photos used here. */}
          {credits
            .filter((b, i) => credits.findIndex((x) => x.user === b.user) === i)
            .map((b, i) => (
              <span key={`${b.pixabayId}-${i}`}>
                {i > 0 && ", "}
                <a href={b.pageURL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {b.user}
                </a>
              </span>
            ))}
        </p>
      )}
      {addonMedia?.music && (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Music: {addonMedia.music.title}
          {addonMedia.music.artist && ` by ${addonMedia.music.artist}`}
        </p>
      )}
    </div>
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
        className="mt-3 rounded-md bg-yellow-400 px-5 py-2 font-semibold text-neutral-900 disabled:opacity-40"
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
                {s.duration.toFixed(1)} s · b-roll: “{s.broll}”
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

/** Optional extras, chosen next to Continue. Choices without library files are shown but disabled. */
function AddonsPicker({ value, onChange }: { value: Addons; onChange: (a: Addons) => void }) {
  const [lib, setLib] = useState<LibraryInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/library")
      .then(readJson)
      .then((body) => setLib(body as unknown as LibraryInfo))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const chip = (on: boolean, disabled: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${
      on ? "border-yellow-400 bg-yellow-400 font-semibold text-neutral-900" : "border-neutral-300 dark:border-neutral-700"
    } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`;

  return (
    <div className="mt-5 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <h3 className="font-semibold">Add-ons</h3>
      {loadError && <p className="mt-1 text-xs text-red-600">Couldn&apos;t load the library: {loadError}</p>}

      <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">Background music</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" className={chip(!value.music, false)} onClick={() => onChange({ ...value, music: undefined })}>
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
              className={chip(value.music === m, disabled)}
              onClick={() => onChange({ ...value, music: m })}
            >
              {MUSIC_LABEL[m]}
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">Split screen (bottom half)</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          className={chip(!value.split, false)}
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
              className={chip(value.split === s, disabled)}
              onClick={() => onChange({ ...value, split: s, gameplayClip: s === "gameplay" ? value.gameplayClip : undefined })}
            >
              {SPLIT_LABEL[s]}
            </button>
          );
        })}
      </div>

      {value.split === "gameplay" && lib && lib.gameplayClips.length > 0 && (
        <>
          <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">Which gameplay? (hover to preview)</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => onChange({ ...value, gameplayClip: undefined })}
              className={`flex aspect-video items-center justify-center rounded-lg border-2 text-sm ${
                !value.gameplayClip ? "border-yellow-400 font-semibold" : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              Any (pick for me)
            </button>
            {lib.gameplayClips.map((c) => {
              const on = value.gameplayClip === c.path;
              return (
                <button
                  key={c.path}
                  type="button"
                  onClick={() => onChange({ ...value, gameplayClip: c.path })}
                  className={`overflow-hidden rounded-lg border-2 text-left ${
                    on ? "border-yellow-400" : "border-neutral-300 dark:border-neutral-700"
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
                  <span className={`block truncate px-2 py-1 text-xs ${on ? "font-semibold" : ""}`}>{c.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {lib && (!lib.gameplay || MUSIC_MOODS.some((m) => !lib.music[m])) && (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          Greyed-out options need files in Supabase Storage → library (music/&lt;mood&gt;/ or gameplay/).
        </p>
      )}
    </div>
  );
}

const STEP_DOT: Record<StepTiming["state"], string> = {
  done: "bg-green-500",
  running: "bg-yellow-400 animate-pulse",
  failed: "bg-red-500",
  pending: "bg-neutral-300 dark:bg-neutral-700",
  skipped: "bg-neutral-300 dark:bg-neutral-700",
};

/** Start-to-finish timer plus each step's duration, ticking live while the job works. */
function TimingPanel({ job }: { job: Job }) {
  const [now, setNow] = useState<number | null>(null);
  const [open, setOpen] = useState(true);
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
  if (!timing) return null;

  return (
    <div className="mt-4 rounded-lg border border-neutral-300 p-3 text-sm dark:border-neutral-700">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="font-semibold">
          ⏱ {formatDuration(timing.processingSeconds)} processing
          <span className="ml-2 font-normal text-neutral-500 dark:text-neutral-400">
            · {formatDuration(timing.wallSeconds)} total incl. your choice
          </span>
        </span>
        <span className="text-xs text-neutral-500">{open ? "Hide steps" : "Show steps"}</span>
      </button>
      {open && (
        <ol className="mt-2 space-y-1">
          {timing.steps.map((s) => (
            <li
              key={s.key}
              className={`flex items-center justify-between ${s.user || s.state === "skipped" ? "text-neutral-500 dark:text-neutral-400" : ""}`}
            >
              <span className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${STEP_DOT[s.state]}`} />
                {s.label}
                {s.user && <span className="text-xs">(not counted)</span>}
                {s.state === "skipped" && <span className="text-xs">(pasted text)</span>}
                {s.state === "failed" && <span className="text-xs text-red-600">failed here</span>}
              </span>
              <span className={`tabular-nums ${s.state === "running" ? "font-semibold" : ""}`}>
                {s.state === "skipped" ? "" : formatDuration(s.seconds)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Everything about one job: live status, point checklist, progress, voiceover and video. */
export function JobView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = the user hasn't changed anything yet, so show the AI's recommended picks.
  const [userSelection, setUserSelection] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [showText, setShowText] = useState(false);
  const [addons, setAddons] = useState<Addons>({});

  const settled = job ? SETTLED_STATUSES.includes(job.status) : false;
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId);

  // Safety net: Realtime can miss updates (e.g. while it warms up on a fresh project), so
  // re-read the row every few seconds whenever the job is still working. Restarts after
  // "Continue", when the job leaves a settled state again.
  useEffect(() => {
    if (!validId || settled) return;
    const poll = setInterval(() => {
      supabaseBrowser()
        .from("jobs")
        .select("*")
        .eq("id", jobId)
        .single()
        .then(({ data }) => data && setJob(data as Job));
    }, 3000);
    return () => clearInterval(poll);
  }, [jobId, validId, settled]);

  // Follow the job row live once we have an id.
  useEffect(() => {
    const supabase = supabaseBrowser();

    const refresh = () =>
      supabase
        .from("jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (data) setJob(data as Job);
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

  function toggle(id: string) {
    const cur = selected;
    setUserSelection(
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX_SELECTED_POINTS ? [...cur, id] : cur,
    );
  }

  async function saveSelection() {
    if (!jobId || !selected.length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pointIds: selected, addons }),
      });
      const body = (await readJson(res)) as { selected: string[] };
      // Realtime will deliver the new status too; set it now so the UI doesn't wait.
      setJob((j) => (j ? { ...j, status: "points_selected", selected_point_ids: body.selected } : j));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const points: CandidatePoint[] = job?.candidate_points ?? [];
  const recommendedIds = points.filter((p) => p.recommended).map((p) => p.id);
  const selected = userSelection ?? recommendedIds;
  const chosen = points.filter((p) => job?.selected_point_ids?.includes(p.id));

  if (notFound || !validId) return <p className="mt-8 text-sm text-red-600">This job doesn&apos;t exist (or was deleted).</p>;
  if (!job) return <p className="mt-8 text-sm text-neutral-500">Loading…</p>;

  return (
    <section className="mt-8">
      <p className="text-sm">
        <span className="font-semibold">{job.original_filename}</span> ·{" "}
        <span className={job.status === "failed" ? "text-red-600" : ""}>{STATUS_LABEL[job.status]}</span>
        {job.page_count != null && ` · ${job.page_count} ${job.page_count === 1 ? "page" : "pages"}`}
        {job.word_count != null && ` · ${job.word_count.toLocaleString()} words`}
      </p>
      {job.error && <p className="mt-2 text-sm text-red-600">{job.error}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <TimingPanel job={job} />

      {job.status === "awaiting_selection" && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Which points should the video cover?</h2>
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              {selected.length} / {MAX_SELECTED_POINTS} selected
            </span>
          </div>
          {recommendedIds.length > 0 && (
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {userSelection === null
                ? "We picked the best points for the video. Adjust them, or just continue."
                : "Your selection. "}
              {userSelection !== null && (
                <button onClick={() => setUserSelection(null)} className="underline underline-offset-2">
                  Reset to recommended
                </button>
              )}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {points.map((p) => {
              const isOn = selected.includes(p.id);
              const atLimit = !isOn && selected.length >= MAX_SELECTED_POINTS;
              return (
                <li key={p.id}>
                  <label
                    className={`flex gap-3 rounded-lg border p-3 ${
                      isOn
                        ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-400/10"
                        : "border-neutral-300 dark:border-neutral-700"
                    } ${atLimit ? "opacity-50" : "cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={atLimit}
                      onChange={() => toggle(p.id)}
                      className="mt-1 h-4 w-4 accent-yellow-500"
                    />
                    <span>
                      <span className="flex items-start gap-2">
                        <TypeBadge type={p.type} />
                        {p.recommended && (
                          <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-900">
                            Recommended
                          </span>
                        )}
                        <span className="text-sm font-medium">{p.text}</span>
                      </span>
                      <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
                        From the article: “{p.evidence}”
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <AddonsPicker value={addons} onChange={setAddons} />
          <button
            onClick={saveSelection}
            disabled={!selected.length || saving}
            className="mt-4 rounded-md bg-yellow-400 px-5 py-2 font-semibold text-neutral-900 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </div>
      )}

      {IN_PRODUCTION.includes(job.status) && (
        <div className="mt-6 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
          <h2 className="font-semibold">{STATUS_LABEL[job.status]}</h2>
          <ProgressSteps status={job.status} renderProgress={job.render_progress} />
          <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">Your points:</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
            {chosen.map((p) => (
              <li key={p.id}>{p.text}</li>
            ))}
          </ol>
        </div>
      )}

      {job.status === "rendered" && (
        <VideoPanel
          jobId={job.id}
          broll={job.broll}
          postCaption={job.script?.postCaption}
          addonMedia={job.addon_media}
        />
      )}

      {/* The script and voiceover can be played while the video renders, and stay below it after. */}
      {job.segments && ["voiced", "fetching_broll", "rendering", "rendered"].includes(job.status) && (
        <VoiceoverPanel jobId={job.id} segments={job.segments} total={job.total_duration_s} script={job.script} />
      )}

      {job.extracted_text && (
        <div className="mt-6">
          <button onClick={() => setShowText((s) => !s)} className="text-sm underline underline-offset-2">
            {showText ? "Hide extracted text" : "Show extracted text"}
          </button>
          {showText && (
            <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-100 p-4 text-sm leading-relaxed dark:bg-neutral-900">
              {job.extracted_text}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
