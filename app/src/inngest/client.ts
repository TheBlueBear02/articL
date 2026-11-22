import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "articl" });

// Event sent once a PDF has finished uploading to Supabase Storage.
export const ARTICLE_UPLOADED = "articl/article.uploaded";
export type ArticleUploadedData = { jobId: string };

// Event sent when the user confirms add-ons / continues (POST /select) — starts Phase 3.
export const POINTS_SELECTED = "articl/points.selected";
export type PointsSelectedData = { jobId: string };

// Event sent once the voiceover is recorded (starts Phase 4: b-roll + render).
export const VOICE_READY = "articl/voice.ready";
export type VoiceReadyData = { jobId: string };

// /create flow: the audience was chosen (or findings regenerated): find and rank the points.
export const AUDIENCE_CHOSEN = "articl/audience.chosen";
export type AudienceChosenData = { jobId: string };

// /create flow: write the hook options for the current lead finding.
export const HOOKS_REQUESTED = "articl/hooks.requested";
export type HooksRequestedData = { jobId: string; /** Add this many hooks under the existing ones. */ more?: number };
