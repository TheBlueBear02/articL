import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "articl" });

// Event sent once a PDF has finished uploading to Supabase Storage.
export const ARTICLE_UPLOADED = "articl/article.uploaded";
export type ArticleUploadedData = { jobId: string };

// Event sent once points are chosen (auto after propose, or via /select recovery) — starts Phase 3.
export const POINTS_SELECTED = "articl/points.selected";
export type PointsSelectedData = { jobId: string };

// Event sent once the voiceover is recorded (starts Phase 4: b-roll + render).
export const VOICE_READY = "articl/voice.ready";
export type VoiceReadyData = { jobId: string };
