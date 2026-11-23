"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { audienceOf, isFindingType, maxPointsFor, type CandidatePoint, type Job, type PointType } from "@/lib/jobs";
import { ActionBar, Button, Card, Chip, ErrorNote, Fold, Skeleton, StepHeading, Working, cx, useMounted } from "./ui";
import { post } from "./use-job";

const TYPE_LABEL: Record<PointType, string> = {
  stat: "Number",
  claim: "Finding",
  quote: "Quote",
  question: "Question",
  method: "Method",
  motivation: "Why it matters",
  limitation: "Limitation",
};

/** Marks the line in the list: points above it are in the video, points below are not. */
const CUT = "__cut__";

/**
 * Starting order: the kept points (the lead the background hooks were written for first, else the
 * first recommended number), the cut line, then every other point.
 */
function initialOrder(job: Job): string[] {
  const all = job.candidate_points ?? [];
  const byId = new Map(all.map((p) => [p.id, p]));
  const saved = job.selected_point_ids?.filter((id) => byId.has(id));
  const ids = (saved?.length ? saved : all.filter((p) => p.recommended).map((p) => p.id)).slice(0, maxPointsFor(audienceOf(job)));
  const findings = ids.filter((id) => isFindingType(byId.get(id)!.type));
  const setup = ids.filter((id) => !isFindingType(byId.get(id)!.type));
  const lead =
    (job.lead_point_id && findings.includes(job.lead_point_id) && job.lead_point_id) ||
    (job.hooks?.leadId && findings.includes(job.hooks.leadId) && job.hooks.leadId) ||
    findings.find((id) => byId.get(id)!.type === "stat") ||
    findings[0];
  const kept = [...(lead ? [lead] : []), ...findings.filter((id) => id !== lead), ...setup];
  return [...kept, CUT, ...all.map((p) => p.id).filter((id) => !kept.includes(id))];
}

/** Keep at most `max` above the line: push the lowest kept point (never `keep`) just below it. */
function capKept(order: string[], max: number, keep?: string): string[] {
  let next = order;
  while (next.indexOf(CUT) > max) {
    const above = next.slice(0, next.indexOf(CUT));
    const out = [...above].reverse().find((id) => id !== keep)!;
    const without = next.filter((id) => id !== out);
    const cut = without.indexOf(CUT);
    next = [...without.slice(0, cut + 1), out, ...without.slice(cut + 1)];
  }
  return next;
}

/** Step 3: keep up to 5 points, drag to order them; the top finding leads. */
export function StepFindings({ job, onDone }: { job: Job; onDone: () => void }) {
  const ready = job.status === "awaiting_findings" || job.status === "awaiting_hook";
  if (!ready) return <FindingsLoading job={job} />;
  return <FindingsPicker key={JSON.stringify(job.candidate_points?.map((p) => p.id))} job={job} onDone={onDone} />;
}

function FindingsLoading({ job }: { job: Job }) {
  return (
    <>
      <StepHeading eyebrow="Step 3 · Findings" title="Finding the key results">
        Each finding comes with the sentence from your paper that backs it up.
      </StepHeading>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} index={i} className="space-y-3 p-5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </Card>
        ))}
      </div>
      <div className="mt-5">
        <Working>{job.status === "proposing" ? "Checking every finding against your paper…" : "Reading your paper…"}</Working>
      </div>
      <ActionBar>
        <Button disabled>Confirm findings</Button>
      </ActionBar>
    </>
  );
}

function FindingsPicker({ job, onDone }: { job: Job; onDone: () => void }) {
  const audience = audienceOf(job);
  const max = maxPointsFor(audience);
  const linkedin = audience === "academic";
  const [points, setPoints] = useState<CandidatePoint[]>(job.candidate_points ?? []);
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const [order, setOrder] = useState<string[]>(() => initialOrder(job));
  const [busy, setBusy] = useState<"confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // dnd-kit's generated ids differ between server and browser: build the sortable list after mount.
  const mounted = useMounted();
  const cut = order.indexOf(CUT);
  const kept = order.slice(0, cut);
  const leadId = kept.find((id) => isFindingType(byId.get(id)!.type));
  const full = kept.length >= max;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const active = String(e.active.id);
    setOrder((list) => capKept(arrayMove(list, list.indexOf(active), list.indexOf(String(e.over!.id))), max, active));
  }

  /** Move a point to just above the line (swapping out the lowest kept one if 5 are kept). */
  const add = (id: string) =>
    setOrder((list) => {
      const without = list.filter((x) => x !== id);
      const c = without.indexOf(CUT);
      return capKept([...without.slice(0, c), id, ...without.slice(c)], max, id);
    });
  /** Move a point to just below the line. */
  const remove = (id: string) =>
    setOrder((list) => {
      const without = list.filter((x) => x !== id);
      const c = without.indexOf(CUT);
      return [...without.slice(0, c + 1), id, ...without.slice(c + 1)];
    });

  async function confirm() {
    if (!leadId) return;
    setBusy("confirm");
    setError(null);
    try {
      await post(job.id, "findings", { pointIds: kept, leadId });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <>
      <StepHeading eyebrow="Step 3 · Findings" title="Confirm your findings">
        Drag points above the line to use them, up to {max}.{" "}
        {linkedin
          ? "The top finding leads: it is the main result, told first after the method."
          : "The top finding leads: the hook teases it and the video builds to it."}
      </StepHeading>

      {/* Fixed height: the list scrolls inside, so the page and the button stay put. */}
      <div className="a2r-scroll -mx-1 h-[min(58vh,560px)] overflow-y-auto rounded-[22px] bg-[var(--a2r-soft)] p-2">
        <SectionLabel>In your video</SectionLabel>
        {!mounted && <Skeleton className="h-40 w-full rounded-[20px]" />}
        {mounted && (
          <DndContext id="findings-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <div className="space-y-2 pb-1">
                {order.map((id, i) =>
                  id === CUT ? (
                    <CutLine key={CUT} empty={kept.length === 0} />
                  ) : (
                    <SortablePoint key={id} id={id}>
                      {(handle, dragging) => {
                        const inVideo = i < cut;
                        const point = byId.get(id)!;
                        return (
                          <PointCard
                            dragging={dragging}
                            jobId={job.id}
                            point={point}
                            index={i}
                            lead={id === leadId}
                            playsFirst={inVideo && (audience === "student" || (linkedin && point.type !== "limitation")) && !isFindingType(point.type)}
                            muted={!inVideo}
                            handle={handle}
                            onRemove={inVideo && kept.length > 1 ? () => remove(id) : undefined}
                            onAdd={inVideo ? undefined : () => add(id)}
                            onEdited={updatePoint}
                          />
                        );
                      }}
                    </SortablePoint>
                  ),
                )}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <ErrorNote>{error}</ErrorNote>
      <ActionBar
        note={
          !leadId
            ? "Keep at least one finding (not only a question or method)."
            : full
              ? "5 is the maximum: adding another swaps out the lowest one."
              : undefined
        }
      >
        <Button disabled={!leadId || !!busy} busy={busy === "confirm"} onClick={confirm}>
          Confirm findings
        </Button>
      </ActionBar>
    </>
  );

  function updatePoint(p: CandidatePoint) {
    setPoints((list) => list.map((x) => (x.id === p.id ? p : x)));
  }
}

/** The line between kept and other points. A sortable item, so cards can be dropped on either side. */
function CutLine({ empty }: { empty: boolean }) {
  const { setNodeRef, transform, transition } = useSortable({ id: CUT, disabled: true });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="px-1 pt-4 pb-2">
      {empty && <p className="pb-3 text-center text-[13px] text-neutral-500">Drag a finding up here, or tap + on one below.</p>}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-neutral-300" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Not in the video</span>
        <span className="h-px flex-1 bg-neutral-300" />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="px-3 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">{children}</p>;
}

function SortablePoint({ id, children }: { id: string; children: (handle: ReactNode, dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      className="-ml-1 mt-0.5 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-neutral-300 active:cursor-grabbing active:text-neutral-600"
    >
      <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden>
        {[3, 9, 15].flatMap((y) => [<circle key={`a${y}`} cx="3" cy={y} r="1.6" />, <circle key={`b${y}`} cx="9" cy={y} r="1.6" />])}
      </svg>
    </button>
  );
  return (
    <div ref={setNodeRef} style={style}>
      {children(handle, isDragging)}
    </div>
  );
}

function PointCard({
  jobId,
  point,
  index,
  lead,
  playsFirst,
  muted,
  handle,
  dragging,
  onRemove,
  onAdd,
  onEdited,
}: {
  jobId: string;
  point: CandidatePoint;
  index: number;
  lead?: boolean;
  playsFirst?: boolean;
  muted?: boolean;
  handle?: ReactNode;
  dragging?: boolean;
  onRemove?: () => void;
  onAdd?: () => void;
  onEdited: (p: CandidatePoint) => void;
}) {
  const [showQuote, setShowQuote] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(point.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await post<{ point: CandidatePoint }>(jobId, "findings/edit", { pointId: point.id, text: draft });
      onEdited(res.point);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      index={index}
      selected={lead}
      className={cx("p-4", dragging && "scale-[1.02] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.35)]", muted && "bg-white/70")}
    >
      <div className="flex items-start gap-3">
        {handle}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {lead && <Chip tone="brand">★ Lead</Chip>}
            {playsFirst && <Chip>Plays first</Chip>}
            <Chip>{TYPE_LABEL[point.type]}</Chip>
            {point.main && !lead && <Chip>Main result</Chip>}
          </div>
          {editing ? (
            <div className="mt-2">
              <textarea
                className="min-h-[88px] w-full resize-none rounded-xl border border-neutral-200 px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-neutral-900 focus:shadow-[0_0_0_3px_var(--a2r-brand-tint)]"
                value={draft}
                maxLength={400}
                onChange={(e) => setDraft(e.target.value)}
              />
              {error && <p className="mt-1.5 text-[12px] text-red-600">{error}</p>}
              <div className="mt-2 flex gap-2">
                <Button className="h-10 flex-none rounded-xl px-4 text-[13px]" busy={saving} onClick={save}>
                  Save
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft(point.text);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className={cx("mt-2 text-[15px] leading-relaxed", muted ? "text-neutral-600" : "text-neutral-950")}>{point.text}</p>
          )}
          <Fold open={showQuote}>
            <blockquote className="mt-3 border-l-2 border-brand pl-3 text-[13px] italic leading-relaxed text-neutral-500">“{point.evidence}”</blockquote>
          </Fold>
          {!editing && (
            <div className="mt-2 -ml-2 flex flex-wrap items-center">
              <SmallAction onClick={() => setShowQuote((s) => !s)}>{showQuote ? "Hide quote" : "From the paper"}</SmallAction>
              <SmallAction onClick={() => setEditing(true)}>Edit</SmallAction>
              {onRemove && <SmallAction onClick={onRemove}>Remove</SmallAction>}
            </div>
          )}
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add to video"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white transition active:scale-90"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </Card>
  );
}

function SmallAction({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900">
      {children}
    </button>
  );
}
