"use client";

import { useState } from "react";
import { HOOK_TYPE_LABEL, type Job } from "@/lib/jobs";
import { ActionBar, Button, Card, Chip, ErrorNote, Fold, Skeleton, Spinner, StepHeading, TextField, Working } from "./ui";
import { post } from "./use-job";

/** Step 4: pick one of the hook options (none is chosen for the user), ask for more, or write your own. */
export function StepHook({ job, onDone }: { job: Job; onDone: () => void }) {
  const hooks = job.hooks;
  const items = hooks?.items ?? [];
  const loading = !hooks;
  /** "More hooks" is writing extra options, shown under the existing ones. */
  const adding = !!hooks?.pending;
  const [picked, setPicked] = useState<number | "own" | null>(null);
  const [own, setOwn] = useState({ hook: "", hookTitle: "" });
  const [busy, setBusy] = useState<"use" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lead = job.candidate_points?.find((p) => p.id === job.lead_point_id);

  async function use() {
    setBusy("use");
    setError(null);
    try {
      await post(job.id, "hook", picked === "own" ? { custom: own } : { index: picked });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  /** Add 2 more hooks under the ones shown; the current choice stays. */
  async function more() {
    setBusy("more");
    setError(null);
    try {
      await post(job.id, "hooks/more");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // Nothing is chosen for the user: they pick one of the hooks (or write their own).
  const canUse =
    picked === "own" ? own.hook.trim().length > 5 && own.hookTitle.trim().length > 1 : picked !== null && !!items[picked];

  return (
    <>
      <StepHeading eyebrow="Step 4 · Hook" title="Choose how it opens">
        The first 2 seconds decide if people keep watching. Each hook teases your lead finding.
      </StepHeading>

      {lead && (
        <p className="mb-4 rounded-2xl bg-[var(--a2r-soft)] px-4 py-3 text-[13px] leading-relaxed text-neutral-600">
          <span className="font-semibold text-neutral-900">Lead: </span>
          {lead.text}
        </p>
      )}

      <div className="space-y-3" role="radiogroup">
        {loading &&
          [0, 1, 2].map((i) => (
            <Card key={i} index={i} className="space-y-3 p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
            </Card>
          ))}
        {!loading && items.length === 0 && (
          <Card className="p-5 text-[14px] leading-relaxed text-neutral-600">
            No hook passed the number checks this time. Try again, or write your own below.
          </Card>
        )}
        {items.map((h, i) => (
          <HookCard key={`${h.type}-${h.hook}`} index={i} selected={picked === i} onSelect={() => setPicked(i)} label={HOOK_TYPE_LABEL[h.type]} {...h} />
        ))}
        {adding &&
          [0, 1].map((i) => (
            <Card key={`more-${i}`} index={i} className="space-y-3 p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
            </Card>
          ))}

        <Card as="div" index={items.length + 1} selected={picked === "own"} className="p-5">
          {/* Opens "Write your own" (and chooses it); tapping again closes it and clears the choice. */}
          <button
            type="button"
            onClick={() => setPicked((p) => (p === "own" ? null : "own"))}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={picked === "own"}
          >
            <span className="text-[15px] font-semibold text-neutral-950">Write your own</span>
            <span className="text-[20px] leading-none text-neutral-400">{picked === "own" ? "–" : "+"}</span>
          </button>
          <Fold open={picked === "own"}>
            <div className="space-y-3 pt-4">
              <TextField
                label="Opening line (spoken)"
                multiline
                maxLength={200}
                value={own.hook}
                onChange={(hook) => setOwn((o) => ({ ...o, hook }))}
                placeholder="Use only numbers from your findings"
              />
              <TextField
                label="On-screen text (up to 7 words)"
                maxLength={60}
                value={own.hookTitle}
                onChange={(hookTitle) => setOwn((o) => ({ ...o, hookTitle }))}
              />
              <p className="text-[12px] leading-relaxed text-neutral-400">Checked like ours: numbers must come from your findings, written as digits.</p>
            </div>
          </Fold>
        </Card>

        {!loading && (
          <div className="flex flex-col items-center gap-2 py-1">
            <button
              type="button"
              onClick={more}
              disabled={adding || busy === "more"}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-neutral-200 bg-white px-5 text-[14px] font-semibold text-neutral-900 transition hover:bg-neutral-50 active:scale-[0.98] disabled:text-neutral-400"
            >
              {adding || busy === "more" ? <Spinner /> : <span className="text-[18px] leading-none">+</span>}
              {adding ? "Writing 2 more hooks…" : items.length ? "More hooks" : "Try again"}
            </button>
            {hooks?.moreFailed && !adding && (
              <p className="text-[12px] text-neutral-500">No new hook passed the checks that time. Try again.</p>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="mt-4">
          <Working>Writing hooks for your lead finding…</Working>
        </div>
      )}

      <ErrorNote>{error}</ErrorNote>
      <ActionBar>
        <Button disabled={!canUse || (loading && picked !== "own")} busy={busy === "use"} onClick={use}>
          Use this hook
        </Button>
      </ActionBar>
    </>
  );
}

function HookCard({
  index,
  selected,
  onSelect,
  label,
  hook,
  hookTitle,
  quote,
}: {
  index: number;
  selected: boolean;
  onSelect: () => void;
  label: string;
  hook: string;
  hookTitle: string;
  quote: string;
}) {
  const [showQuote, setShowQuote] = useState(false);
  return (
    <Card index={index} selected={selected} className="p-5">
      <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className="block w-full text-left">
        <span className="flex items-center justify-between">
          <Chip tone={selected ? "brand" : "neutral"}>{label}</Chip>
          <span className={`h-5 w-5 rounded-full border-2 transition ${selected ? "border-neutral-950 bg-brand" : "border-neutral-300"}`} />
        </span>
        <span className="mt-3 block text-[19px] font-semibold leading-snug tracking-[-0.01em] text-neutral-950">“{hook}”</span>
        <span className="mt-3 inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-2.5 py-1.5 text-[12px] font-bold uppercase tracking-wide text-white">
          <span className="text-[10px] font-medium text-neutral-400 normal-case">On screen</span>
          {hookTitle}
        </span>
      </button>
      <button type="button" onClick={() => setShowQuote((s) => !s)} className="mt-3 text-[12px] font-medium text-neutral-500 hover:text-neutral-900">
        {showQuote ? "Hide the quote" : "The quote behind it"}
      </button>
      <Fold open={showQuote}>
        <blockquote className="mt-2 border-l-2 border-brand pl-3 text-[13px] italic leading-relaxed text-neutral-500">“{quote}”</blockquote>
      </Fold>
    </Card>
  );
}
