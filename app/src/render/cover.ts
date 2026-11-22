import "server-only";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/supabase/jobs-db";
import type { Segment } from "@/lib/jobs";
import { buildTimeline } from "./composition";
import { extractFrame } from "./local";

/** When the chosen part's frame is taken: the hook at 1 s (with its title), others a little in. */
export function coverTime(segments: Segment[], segment: number | null | undefined): number {
  const t = buildTimeline(segments).segments[segment ?? 0];
  if (!t || t.index === 0) return 1;
  return t.start + Math.min(1.2, t.length / 2);
}

/** Save the frame at the chosen part as the video's cover (`<jobId>/thumb.jpg`). */
export async function saveCover(jobId: string, video: { path: string } | { bytes: Buffer }, at: number): Promise<void> {
  const file = "path" in video ? video.path : path.join(tmpdir(), `articl-cover-${jobId}-${Date.now()}.mp4`);
  try {
    if (!("path" in video)) await writeFile(file, video.bytes);
    const thumb = await extractFrame(file, at);
    const { error } = await supabaseAdmin()
      .storage.from(MEDIA_BUCKET)
      .upload(`${jobId}/thumb.jpg`, thumb, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(error.message);
  } finally {
    if (!("path" in video)) await rm(file, { force: true });
  }
}
