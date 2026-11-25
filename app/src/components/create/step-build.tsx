"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { POST_PLATFORMS, type Job, type PostPlatform } from "@/lib/jobs";
import { defaultPostText, PLATFORM_LABEL } from "@/lib/post-text";
import { ActionBar, Button, Card, Check, ErrorNote, Segmented, Spinner, StepHeading, Working, cx } from "./ui";
import { scriptBlocks } from "./step-review";
import { PlatformIcon } from "./platform-icons";
import { post, track } from "./use-job";

/** Signed links to the part thumbnails (and the cover once rendered); re-read when they change. */
export function useMediaLinks(job: Job) {
  const [links, setLinks] = useState<{ blocks: (string | null)[]; cover: string | null }>({ blocks: [], cover: null });
  const key = `${JSON.stringify(job.block_thumbs ?? null)}|${job.status === "rendered"}|${job.cover_segment ?? ""}`;
  useEffect(() => {
    if (!job.block_thumbs?.length && job.status !== "rendered") return;
    let live = true;
    fetch(`/api/jobs/${job.id}/media`)
      .then((r) => r.json())
      .then((d) => live && !d.error && setLinks(d))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, job.id]);
  return links;
}

/** Step 6: a live build tracker, with the post text, cover and a feedback question to fill the wait. */
export function StepBuild({ job, onDone }: { job: Job; onDone: () => void }) {
  const blocks = scriptBlocks(job);
  const links = useMediaLinks(job);
  const rendered = job.status === "rendered";
  const failed = job.status === "failed";
  const progress = rendered ? 100 : job.status === "rendering" ? (job.render_progress ?? 0) : 0;

  // A part is built once the render has passed its end on the timeline.
  const ends = useMemo(() => {
    const durations = (job.segments ?? []).map((s) => s.duration);
    const total = durations.reduce((a, b) => a + b, 0) || 1;
    return durations.map((_, i) => (durations.slice(0, i + 1).reduce((a, b) => a + b, 0) / total) * 100);
  }, [job.segments]);

  const stage = rendered
    ? "Your video is ready"
    : failed
      ? "Something went wrong"
      : job.status === "rendering"
        ? `Rendering · ${progress}%`
        : "Finding photos and clips…";

  return (
    <>
      <StepHeading step={7} eyebrow="Step 7 · Creating the video" title={rendered ? "It's ready" : "Building your video"}>
        {rendered ? "Choose a cover and grab your post text, then watch it." : "About 4 minutes. Get your post ready meanwhile."}
      </StepHeading>

      <Card index={0} className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold text-neutral-950">{stage}</p>
          {!rendered && !failed && <Spinner className="text-neutral-400" />}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: `${Math.max(progress, job.status === "fetching_broll" ? 6 : 3)}%` }} />
        </div>
        <ol className="mt-5 space-y-3">
          {blocks.map((b, i) => {
            const done = rendered || (job.status === "rendering" && progress >= (ends[i] ?? 100) - 0.5);
            const thumb = links.blocks[i];
            return (
              <li key={b.segment} className="flex items-center gap-3">
                <div className="relative h-[52px] w-[30px] shrink-0 overflow-hidden rounded-md bg-neutral-100">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="a2r-rise h-full w-full object-cover" />
                  ) : (
                    <div className="a2r-skeleton h-full w-full" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-neutral-900">{b.title}</p>
                  <p className="truncate text-[12px] text-neutral-500">{b.text}</p>
                </div>
                {done ? <Check /> : <span className="h-5 w-5 rounded-full border-2 border-neutral-200" />}
              </li>
            );
          })}
        </ol>
      </Card>

      {failed && <ErrorNote>{job.error ?? "The video couldn't be made."}</ErrorNote>}

      <div className="mt-3 space-y-3">
        <PostTextCard job={job} index={1} />
        <CoverCard job={job} links={links.blocks} titles={blocks.map((b) => b.title)} index={2} />
        <FeedbackCard jobId={job.id} index={3} />
      </div>

      <ActionBar>
        <Button disabled={!rendered} onClick={onDone}>
          {rendered ? "Watch your video" : `Rendering… ${progress}%`}
        </Button>
      </ActionBar>
    </>
  );
}

/** The text to post, per platform: editable (saved as you type) and one tap to copy. */
export function PostTextCard({ job, index }: { job: Job; index: number }) {
  const [platform, setPlatform] = useState<PostPlatform>("instagram");
  const initial = (p: PostPlatform) => job.post_texts?.[p] ?? defaultPostText(p, job.script, job.author_info, job.paper_meta);
  const [texts, setTexts] = useState<Record<PostPlatform, string>>(
    () => Object.fromEntries(POST_PLATFORMS.map((p) => [p, initial(p)])) as Record<PostPlatform, string>,
  );
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function edit(text: string) {
    setTexts((t) => ({ ...t, [platform]: text }));
    if (timer.current) clearTimeout(timer.current);
    const p = platform;
    timer.current = setTimeout(() => void post(job.id, "post-text", { platform: p, text }).catch(() => {}), 700);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(texts[platform]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      track(job.id, "copy_post_text", { platform });
    } catch {
      // Clipboard blocked: the text is still selectable in the box.
    }
  }

  return (
    <Card index={index} className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold text-neutral-950">Post text</p>
        <button type="button" onClick={copy} className="rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-neutral-900 transition hover:bg-neutral-100">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <div className="mt-3">
        <Segmented value={platform} onChange={setPlatform} options={POST_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p], icon: <PlatformIcon platform={p} className="shrink-0" /> }))} />
      </div>
      <textarea
        aria-label={`${PLATFORM_LABEL[platform]} post text`}
        className="a2r-scroll mt-3 h-44 w-full resize-none rounded-xl border border-neutral-200 px-3.5 py-3 text-[14px] leading-relaxed text-neutral-900 outline-none focus:border-neutral-900 focus:shadow-[0_0_0_3px_var(--a2r-brand-tint)]"
        value={texts[platform]}
        onChange={(e) => edit(e.target.value)}
      />
    </Card>
  );
}

function CoverCard({ job, links, titles, index }: { job: Job; links: (string | null)[]; titles: string[]; index: number }) {
  const [chosen, setChosen] = useState<number>(job.cover_segment ?? 0);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(segment: number) {
    setChosen(segment);
    setSaving(segment);
    setError(null);
    try {
      await post(job.id, "cover", { segment });
      track(job.id, "cover_chosen", { segment });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card index={index} className="p-5">
      <p className="text-[15px] font-semibold text-neutral-950">Cover frame</p>
      <p className="mt-0.5 text-[13px] text-neutral-500">The still people see before they tap play.</p>
      {links.length === 0 ? (
        <div className="mt-4">
          <Working>Frames appear once the visuals are found…</Working>
        </div>
      ) : (
        <div className="a2r-noscrollbar -mx-5 mt-4 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1">
          {links.map((url, i) =>
            url ? (
              <button
                key={i}
                type="button"
                onClick={() => choose(i)}
                aria-pressed={chosen === i}
                aria-label={`Use ${titles[i] ?? `part ${i + 1}`} as the cover`}
                className={cx(
                  "relative h-[128px] w-[72px] shrink-0 snap-start overflow-hidden rounded-xl transition duration-200",
                  chosen === i ? "shadow-[0_0_0_2.5px_var(--a2r-brand)]" : "opacity-80",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-left text-[9px] font-semibold text-white">
                  {titles[i]}
                </span>
                {saving === i && (
                  <span className="absolute inset-0 flex items-center justify-center bg-white/50">
                    <Spinner />
                  </span>
                )}
              </button>
            ) : null,
          )}
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

const FEELINGS = [
  { value: "great", label: "Loved it" },
  { value: "good", label: "Good" },
  { value: "meh", label: "Okay" },
  { value: "bad", label: "Not great" },
];

function FeedbackCard({ jobId, index }: { jobId: string; index: number }) {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <Card index={index} className="p-5">
      <p className="text-[15px] font-semibold text-neutral-950">{sent ? "Thanks, that helps" : "How did this go?"}</p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {FEELINGS.map((f) => (
          <button
            key={f.value}
            type="button"
            disabled={!!sent}
            onClick={() => {
              setSent(f.value);
              track(jobId, "feedback", { rating: f.value });
            }}
            className={cx(
              "h-11 rounded-xl text-[12px] font-medium transition duration-200 active:scale-95",
              sent === f.value ? "bg-brand text-neutral-950" : "bg-neutral-100 text-neutral-600 disabled:opacity-50",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
