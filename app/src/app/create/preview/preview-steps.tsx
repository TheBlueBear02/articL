"use client";

import { useState } from "react";
import type { Job } from "@/lib/jobs";
import { Shell } from "@/components/create/create-flow";
import { PaperCard } from "@/components/create/step-upload";
import { StepFindings } from "@/components/create/step-findings";
import { StepHook } from "@/components/create/step-hook";
import { StepAddons } from "@/components/create/step-addons";
import { StepReview } from "@/components/create/step-review";
import { StepBuild } from "@/components/create/step-build";
import { StepResult } from "@/components/create/step-result";

// Dev-only design preview of each step with made-up sample data (no database, buttons do nothing useful).
const SAMPLE: Job = {
  id: "00000000-0000-0000-0000-000000000000",
  status: "awaiting_findings",
  original_filename: "sample-paper.pdf",
  file_path: "",
  page_count: 34,
  word_count: 12000,
  extracted_text: null,
  audience: "social",
  audience_confirmed: true,
  flow: "create",
  paper_meta: { title: "Sample title: How a small change shifted a big outcome", authors: ["A. Author", "B. Author"], year: "2021" },
  candidate_points: [
    { id: "p1", type: "stat", text: "Sample finding one with a number, 12 percent.", evidence: "Sample quote sentence that supports finding one, 12 percent.", recommended: true },
    { id: "p2", type: "claim", text: "Sample finding two, a plain claim.", evidence: "Sample quote sentence for finding two.", recommended: true },
    { id: "p3", type: "stat", text: "Sample finding three with 3 groups.", evidence: "Sample quote sentence for finding three with 3 groups.", recommended: true },
    { id: "p4", type: "quote", text: "Sample quote-type point.", evidence: "Sample striking sentence.", recommended: true },
    { id: "p5", type: "claim", text: "Sample extra finding.", evidence: "Sample supporting sentence.", recommended: true },
    { id: "p6", type: "stat", text: "Sample sixth point, not picked, 40 people.", evidence: "Sample sentence with 40 people.", recommended: false },
    { id: "p7", type: "claim", text: "Sample seventh point, not picked.", evidence: "Sample sentence seven.", recommended: false },
  ],
  study_setting: null,
  selected_point_ids: ["p2", "p3", "p1"],
  lead_point_id: "p1",
  hooks: {
    leadId: "p1",
    pointIds: ["p1", "p2", "p3"],
    items: [
      { type: "number", hook: "Sample hook line that opens on a number, 3 groups.", hookTitle: "Sample on-screen title", pointId: "p3", quote: "Sample quote sentence for finding three with 3 groups." },
      { type: "myth", hook: "Sample myth-buster hook line about a common belief.", hookTitle: "Sample myth title", pointId: "p1", quote: "Sample quote sentence that supports finding one, 12 percent." },
      { type: "you", hook: "Sample hook that speaks to the viewer's own life.", hookTitle: "Sample about-you title", pointId: "p2", quote: "Sample quote sentence for finding two." },
    ],
  },
  script: {
    hook: "Sample hook line that opens on a number, 3 groups.",
    hookTitle: "Sample on-screen title",
    hookBroll: "",
    payoffPointId: "p1",
    beats: [
      { pointId: "p2", text: "Sample beat for finding two, a plain claim.", broll: "" },
      { pointId: "p3", text: "Sample beat for finding three with 3 groups.", broll: "" },
      { pointId: "p1", text: "Sample lead beat that proves finding one, 12 percent.", broll: "" },
    ],
    closing: "Sample closing lead-in, and that is why",
    closingBroll: "",
    postCaption: "Sample caption sentence.\nWhat do you think? Tell us below.\n#research #science #sample",
  },
  segments: [3, 5, 6, 7, 3].map((duration, i) => ({ kind: "beat" as const, text: "", broll: "", audioPath: "", duration, words: [], pointId: `s${i}` })),
  total_duration_s: 24,
  script_flags: [{ segment: 3, problem: "Sample: the study shows a link, not proof.", softer: "Sample softer lead beat that links finding one, 12 percent.", state: "open" }],
  chosen_hook: { type: "number", hook: "Sample hook line that opens on a number, 3 groups.", hookTitle: "Sample on-screen title" },
  render_progress: 46,
  broll: null,
  video_path: null,
  selected_at: null,
  error: null,
  created_at: "",
  updated_at: "",
};

const STEPS: Record<number, Partial<Job>> = {
  1: { status: "extracting", paper_meta: null },
  2: { status: "awaiting_findings", selected_point_ids: null, lead_point_id: null },
  3: { status: "awaiting_hook" },
  4: { status: "scripting" },
  5: { status: "awaiting_review" },
  6: { status: "rendering" },
  7: { status: "rendered", video_path: "sample.mp4" },
};

export function PreviewSteps({ step }: { step: number }) {
  const [job] = useState<Job>({ ...SAMPLE, ...(STEPS[step] ?? {}) });
  const noop = () => {};
  return (
    <Shell step={step} job={job}>
      <div key={step} className="a2r-step-next">
        {step === 1 && <PaperCard filename={job.original_filename} job={job} />}
        {step === 2 && <StepFindings job={job} onDone={noop} />}
        {step === 3 && <StepHook job={job} onDone={noop} />}
        {step === 4 && <StepAddons job={job} onDone={noop} />}
        {step === 5 && <StepReview job={job} onDone={noop} />}
        {step === 6 && <StepBuild job={job} onDone={noop} />}
        {step === 7 && <StepResult job={job} />}
      </div>
    </Shell>
  );
}
