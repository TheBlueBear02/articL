"use client";

import { useState } from "react";
import { audienceOf, type CandidatePoint, type Job, type ScriptFlag } from "@/lib/jobs";
import { scriptSegments } from "@/lib/script-checks";
import { ActionBar, Button, Card, Chip, ErrorNote, Fold, Skeleton, StepHeading, Working, cx } from "./ui";
import { scriptProgress } from "./step-addons";
import { post } from "./use-job";

export type Block = { segment: number; title: string; text: string; quote?: string };

/** The script as titled blocks, in the order it is recorded (also used by the build tracker). */
export function scriptBlocks(job: Job): Block[] {
  if (!job.script) return [];
  const student = audienceOf(job) === "student";
  const points = new Map((job.candidate_points ?? []).map((p) => [p.id, p] as [string, CandidatePoint]));
  const parts = scriptSegments(job.script);
  const hookQuote =
    job.hooks?.items.find((h) => h.hook === job.chosen_hook?.hook)?.quote ?? points.get(job.lead_point_id ?? "")?.evidence;
  let finding = 0;
  return parts.map((part, segment) => {
    if (part.kind === "hook") return { segment, title: "Hook", text: part.text, quote: hookQuote };
    if (part.kind === "closing") return { segment, title: student ? "Why it matters" : "Takeaway", text: part.text };
    const p = points.get(part.pointId);
    const isLead = part.pointId === job.lead_point_id;
    let title: string;
    if (student && p?.type === "question") title = "The question";
    else if (student && p?.type === "method") title = "How they tested it";
    else title = isLead ? "Lead finding" : `Finding ${++finding}`;
    return { segment, title, text: part.text, quote: p?.evidence };
  });
}

/** Step 6: read the script block by block, accept softer wording where it overclaims, approve. */
export function StepReview({ job, onDone }: { job: Job; onDone: () => void }) {
  const ready = job.status === "awaiting_review";
  const blocks = ready ? scriptBlocks(job) : [];
  const flags = new Map((job.script_flags ?? []).map((f) => [f.segment, f]));
  const open = (job.script_flags ?? []).filter((f) => f.state === "open").length;
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(segment: number, action: "accept" | "keep") {
    setBusy(segment);
    setError(null);
    try {
      await post(job.id, "flag", { segment, action });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      await post(job.id, "approve");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <>
      <StepHeading eyebrow="Step 6 · Script" title="Review your script">
        Tap a block to see its line and the quote behind it.
        {job.total_duration_s && ready ? ` About ${Math.round(job.total_duration_s)} seconds.` : ""}
      </StepHeading>

      {ready && open > 0 && (
        <p className="a2r-rise mb-4 flex items-start gap-2.5 rounded-2xl bg-orange-50 px-4 py-3 text-[13px] leading-relaxed text-neutral-700">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--a2r-warn)]" />
          {open === 1 ? "1 line may claim more than the paper says." : `${open} lines may claim more than the paper says.`} We suggest softer wording.
        </p>
      )}

      <div className="space-y-2.5">
        {!ready &&
          [0, 1, 2, 3].map((i) => (
            <Card key={i} index={i} className="space-y-3 p-5">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-4 w-full" />
            </Card>
          ))}
        {blocks.map((b, i) => (
          <BlockCard
            key={b.segment}
            block={b}
            index={i}
            flag={flags.get(b.segment)}
            open={expanded === b.segment}
            onToggle={() => setExpanded((x) => (x === b.segment ? null : b.segment))}
            busy={busy === b.segment}
            onAccept={() => act(b.segment, "accept")}
            onKeep={() => act(b.segment, "keep")}
          />
        ))}
      </div>

      {!ready && (
        <div className="mt-5">
          <Working>{scriptProgress(job)}</Working>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      <ActionBar note={ready ? "Every number is checked against your paper." : undefined}>
        <Button disabled={!ready || typeof busy === "number"} busy={busy === "approve"} onClick={approve}>
          Approve &amp; create
        </Button>
      </ActionBar>
    </>
  );
}

function BlockCard({
  block,
  index,
  flag,
  open,
  onToggle,
  busy,
  onAccept,
  onKeep,
}: {
  block: Block;
  index: number;
  flag?: ScriptFlag;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onAccept: () => void;
  onKeep: () => void;
}) {
  const flagged = flag?.state === "open";
  return (
    <Card index={index} selected={open} className="overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-5 py-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">{block.title}</span>
            {flagged && <span className="h-2 w-2 rounded-full bg-[var(--a2r-warn)]" aria-label="May overclaim" />}
            {flag?.state === "accepted" && <Chip>Softened</Chip>}
          </span>
          <span className={cx("mt-1.5 block text-[15px] leading-relaxed text-neutral-900", !open && "line-clamp-2")}>{block.text}</span>
        </span>
        <svg className={`mt-1 shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="#a3a3a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Fold open={open}>
        <div className="px-5 pb-5">
          {block.quote ? (
            <blockquote className="border-l-2 border-brand pl-3 text-[13px] italic leading-relaxed text-neutral-500">“{block.quote}”</blockquote>
          ) : (
            <p className="text-[13px] text-neutral-400">Sums up the findings above.</p>
          )}
        </div>
      </Fold>
      {flagged && flag && (
        <div className="border-t border-orange-100 bg-orange-50/60 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-neutral-700">{flag.problem}</p>
          <p className="mt-2 rounded-xl bg-white px-3.5 py-3 text-[14px] leading-relaxed text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">{flag.softer}</p>
          <div className="mt-3 flex gap-2">
            <Button className="h-10 rounded-xl text-[13px]" busy={busy} onClick={onAccept}>
              {busy ? "Re-recording…" : "Use softer wording"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onKeep}>
              Keep mine
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
