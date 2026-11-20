import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { inngest, VOICE_READY, type VoiceReadyData } from "./client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { setJob, MEDIA_BUCKET } from "@/lib/supabase/jobs-db";
import { searchPhotosCached, searchVideosCached } from "@/lib/pixabay";
import { cleanQuery, downloadMedia, photoCandidates, pickShotMedia, placeSearchWords, type PhotoHit } from "@/lib/pixabay-api";
import { pickPhoto } from "@/lib/openai";
import {
  BOTTOM_LEAD_S,
  buildCompositionHtml,
  buildTimeline,
  FADE_S,
  HYPERFRAMES_JSON,
  LOOP_LEAD_S,
  planBottomShots,
  planMusic,
  planPopups,
  planShots,
  withLoopEnding,
  type BottomSource,
  type CompositionExtras,
} from "@/render/composition";
import { probeDuration, projectDir, readRenderStatus, startRender, VIDEO_FILE, writeProject } from "@/render/local";
import { downloadLibraryFile, listGameplay, listMusic, pickFor, trackCredit } from "@/lib/library";
import type { AddonMedia, Addons, BrollImage, PopupMedia, Script, Segment, StudySetting } from "@/lib/jobs";

/** Split-screen "satisfying" footage: Pixabay searches that tested well (long clips, matching tags). */
const SATISFYING_QUERIES = ["marble run", "pottery wheel", "skateboarding", "snowboard", "roller coaster", "toy car racing"];
const SATISFYING_PIECE_S = 12;

/** Add-on choices; {} for jobs (or databases) from before migration 0005. */
async function readAddons(jobId: string): Promise<Addons> {
  const { data, error } = await supabaseAdmin().from("jobs").select("addons").eq("id", jobId).single();
  return error ? {} : ((data?.addons ?? {}) as Addons);
}

async function readAddonMedia(jobId: string): Promise<AddonMedia> {
  const { data, error } = await supabaseAdmin().from("jobs").select("addon_media").eq("id", jobId).single();
  return error ? {} : ((data?.addon_media ?? {}) as AddonMedia);
}

/** At most this many AI photo checks per pop-up (one per search tried). */
const MAX_PHOTO_CHECKS = 2;

/**
 * Pop-up photos: time each beat's pop-up word first (so no photo is fetched for a slot that can't
 * be shown), then search Pixabay, most specific first: the study's place + the search ("afghanistan
 * village"), the search, the word. Real photos whose tags strictly match go to a vision model,
 * which picks the one that fits the word and the study's setting, or rejects them all.
 * Testing (tags only): a Bavarian church for "villages" in Afghanistan, a Christmas scene for
 * "household income". A pop-up without a good photo is skipped. Never fails the video.
 */
async function pickPopups(
  jobId: string,
  segments: Segment[],
  usedPhotos: Set<number>,
  place: string | undefined,
): Promise<PopupMedia[]> {
  const requests = segments.flatMap((s, segment) => (s.kind === "beat" && s.popup ? [{ segment, word: s.popup.word }] : []));
  const slots = planPopups(buildTimeline(segments), requests);
  const where = placeSearchWords(place);
  const out: PopupMedia[] = [];
  for (const slot of slots) {
    const seg = segments[slot.segment];
    const popup = seg.popup!;
    try {
      let hit: PhotoHit | undefined;
      let query = "";
      let checks = 0;
      const searches = [where && `${where} ${popup.query}`, popup.query, popup.word].map((q) => cleanQuery(q || ""));
      for (const q of [...new Set(searches.filter(Boolean))]) {
        const candidates = photoCandidates(await searchPhotosCached(q), q, usedPhotos);
        if (!candidates.length) continue;
        if (checks >= MAX_PHOTO_CHECKS) break;
        checks++;
        try {
          const pick = await pickPhoto({ word: popup.word, sentence: seg.text, place, imageUrls: candidates.map((c) => c.webformatURL!) });
          console.log(`[render-video] pop-up "${popup.word}" / "${q}": ${pick.index < 0 ? "none fit" : `photo ${pick.index + 1}`} (${pick.reason})`);
          if (pick.index < 0) continue;
          hit = candidates[pick.index];
        } catch (e) {
          // Without the check, fall back to the best tag match rather than lose the pop-up.
          console.warn(`[render-video] photo check failed for "${popup.word}": ${e instanceof Error ? e.message : e}`);
          hit = candidates[0];
        }
        query = q;
        break;
      }
      if (!hit) continue;
      usedPhotos.add(hit.id);
      const imagePath = `${jobId}/popup-${out.length}.jpg`;
      const image = await downloadMedia(hit.largeImageURL, "image");
      const { error } = await supabaseAdmin()
        .storage.from(MEDIA_BUCKET)
        .upload(imagePath, image, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(error.message);
      out.push({ ...slot, side: out.length % 2 === 0 ? "left" : "right", query, imagePath, pixabayId: hit.id, user: hit.user, pageURL: hit.pageURL });
    } catch (e) {
      console.warn(`[render-video] pop-up "${popup.word}" skipped for ${jobId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

const POLL_EVERY = "20s";
const MAX_POLLS = 120; // 40 minutes; a ~50 s video takes ~10-12 min on the dev laptop

async function download(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin().storage.from(MEDIA_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`Downloading ${storagePath} failed: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

// Phase 4: voiced job -> Pixabay b-roll -> HyperFrames composition -> local render -> MP4 in Storage.
export const renderVideo = inngest.createFunction(
  {
    id: "render-video",
    triggers: [{ event: VOICE_READY }],
    retries: 1,
    onFailure: async ({ event, error }) => {
      const { jobId } = event.data.event.data as VoiceReadyData;
      await setJob(jobId, { status: "failed", error: error.message });
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as VoiceReadyData;

    await step.run("fetch-broll", async () => {
      await setJob(jobId, { status: "fetching_broll", render_progress: 0, error: null });
      const { data: job, error } = await supabaseAdmin().from("jobs").select("segments").eq("id", jobId).single();
      if (error || !job?.segments) throw new Error(`No voiceover segments for job ${jobId}`);
      const segments = job.segments as Segment[];

      // ~3 s shots; each gets its segment's next shot search (older jobs: the one b-roll term).
      const shots = planShots(buildTimeline(segments));
      const requests = shots.map((sh) => {
        const seg = segments[sh.segment];
        const queries = seg.shots?.length ? seg.shots : [seg.broll];
        return { query: queries[sh.shot % queries.length], topic: seg.broll, length: sh.length };
      });
      // The hook's topic is the most general one, so it's the video-wide fallback.
      const picks = await pickShotMedia(
        requests,
        segments[0]?.broll ?? "news",
        { videos: searchVideosCached, photos: searchPhotosCached },
        FADE_S,
        LOOP_LEAD_S, // the loop shot at the end replays the seconds just before the first clip's start
      );

      const broll: BrollImage[] = [];
      for (const [g, pick] of picks.entries()) {
        const base = { segment: shots[g].segment, shot: shots[g].shot, query: pick.query };
        const credit = { pixabayId: pick.hit.id, user: pick.hit.user, pageURL: pick.hit.pageURL };
        if (pick.kind === "video") {
          broll.push({ ...base, kind: "video", videoUrl: pick.file.url, mediaStart: pick.mediaStart, ...credit });
          continue;
        }
        // Photos: Pixabay forbids permanent hotlinking, so keep our own copy.
        const image = await downloadMedia(pick.hit.largeImageURL, "image");
        const imagePath = `${jobId}/shot-${g}.jpg`;
        const { error: upErr } = await supabaseAdmin()
          .storage.from(MEDIA_BUCKET)
          .upload(imagePath, image, { contentType: "image/jpeg", upsert: true });
        if (upErr) throw new Error(`Uploading ${imagePath} failed: ${upErr.message}`);
        broll.push({ ...base, kind: "image", imagePath, ...credit });
      }
      await setJob(jobId, { broll });

      // ---- Add-ons: pick the music track and the bottom-half footage ----
      const addons = await readAddons(jobId);
      const addonMedia: AddonMedia = {};
      if (addons.music) {
        const track = pickFor(jobId, await listMusic(addons.music), "music");
        if (track) addonMedia.music = { path: track, ...trackCredit(track) };
      }
      if (addons.split === "gameplay") {
        const clips = await listGameplay();
        // The user's chosen clip if it's still there, otherwise a different clip per job. The rest
        // follow only in case the first is too short to fill the video.
        const chosen = addons.gameplayClip && clips.includes(addons.gameplayClip) ? addons.gameplayClip : undefined;
        const first = chosen ?? pickFor(jobId, clips, "gameplay");
        const ordered = first ? [first, ...clips.filter((c) => c !== first)] : [];
        addonMedia.bottom = ordered.map((p) => ({ source: "library" as const, path: p }));
      } else if (addons.split === "satisfying") {
        const film = buildTimeline(segments).duration;
        const n = Math.max(1, Math.ceil(film / SATISFYING_PIECE_S));
        const requests = Array.from({ length: n }, (_, i) => ({
          query: SATISFYING_QUERIES[(i + jobId.charCodeAt(0)) % SATISFYING_QUERIES.length],
          length: film / n,
        }));
        // An add-on should never fail the whole video: without matching clips, render without it.
        const picks = await pickShotMedia(
          requests,
          SATISFYING_QUERIES[0],
          { videos: searchVideosCached, photos: async () => [] }, // video only: a still photo isn't "satisfying"
          FADE_S,
          BOTTOM_LEAD_S - 0.5, // pickShotMedia already adds its own 0.5 s lead-in
        ).catch((e) => {
          console.warn(`[render-video] no satisfying clips for ${jobId}: ${e instanceof Error ? e.message : e}`);
          return [];
        });
        addonMedia.bottom = picks.flatMap((p) =>
          p.kind === "video"
            ? [
                {
                  source: "pixabay" as const,
                  videoUrl: p.file.url,
                  duration: p.hit.duration,
                  mediaStart: p.mediaStart,
                  query: p.query,
                  pixabayId: p.hit.id,
                  user: p.hit.user,
                  pageURL: p.hit.pageURL,
                },
              ]
            : [],
        );
      }
      if (addons.popups) {
        const usedPhotos = new Set(picks.filter((p) => p.kind === "image").map((p) => p.hit.id));
        // The study's place makes searches and the photo check specific (column from migration 0007).
        const { data: s } = await supabaseAdmin().from("jobs").select("study_setting").eq("id", jobId).single();
        const place = (s?.study_setting as StudySetting | null)?.place?.value;
        addonMedia.popups = await pickPopups(jobId, segments, usedPhotos, place);
      }
      if (addonMedia.music || addonMedia.bottom?.length || addonMedia.popups?.length) {
        await setJob(jobId, { addon_media: addonMedia });
      }

      return {
        shots: broll.length,
        videos: broll.filter((b) => b.kind === "video").length,
        music: addonMedia.music?.path ?? null,
        bottom: addonMedia.bottom?.length ?? 0,
        popups: addonMedia.popups?.map((p) => `${p.word} @ ${p.start}s (${p.query})`) ?? [],
      };
    });

    await step.run("start-render", async () => {
      await setJob(jobId, { status: "rendering", render_progress: 0 });
      const { data: job, error } = await supabaseAdmin()
        .from("jobs")
        .select("segments, broll, script")
        .eq("id", jobId)
        .single();
      if (error || !job) throw new Error(`Job ${jobId} not found: ${error?.message}`);
      const segments = job.segments as Segment[];
      const broll = job.broll as BrollImage[];
      const script = job.script as Script | null;

      // Same deterministic plan as in fetch-broll, so shot g lines up with broll[g].
      const timeline = buildTimeline(segments);
      const shots = planShots(timeline);
      if (shots.length !== broll.length) throw new Error(`Shot plan (${shots.length}) doesn't match b-roll (${broll.length}).`);

      const audio = await Promise.all(
        segments.map((s, i) => download(s.audioPath).then((content) => ({ path: timeline.segments[i].audioFile, content }))),
      );
      // Clips one at a time: Pixabay's CDN throttles bursts.
      const media: { path: string; content: Buffer }[] = [];
      for (const [g, b] of broll.entries()) {
        const file = `assets/shot-${g}.${b.kind === "video" ? "mp4" : "jpg"}`;
        const content = b.kind === "video" ? await downloadMedia(b.videoUrl!, "video") : await download(b.imagePath!);
        media.push({ path: file, content });
      }
      const withMedia = withLoopEnding(
        shots.map((sh, g) => ({
          ...sh,
          media: {
            kind: broll[g].kind === "video" ? ("video" as const) : ("image" as const),
            file: media[g].path,
            mediaStart: broll[g].mediaStart,
          },
        })),
        timeline.duration,
      );
      // ---- Add-ons ----
      const addonMedia = await readAddonMedia(jobId);
      const extraFiles: { path: string; content: Buffer }[] = [];

      let music: CompositionExtras["music"];
      if (addonMedia.music) {
        const content = await downloadLibraryFile(addonMedia.music.path);
        const ext = addonMedia.music.path.split(".").pop()!.toLowerCase();
        const clips = planMusic(await probeDuration(content, ext), timeline.duration);
        if (clips) {
          music = { file: `assets/music.${ext}`, clips };
          extraFiles.push({ path: music.file, content });
        } else {
          console.warn(`[render-video] ${addonMedia.music.path} is too short for a ${timeline.duration}s video; no music.`);
        }
      }

      // Bottom half: download clips until there's enough footage to fill the film.
      const sources: BottomSource[] = [];
      let footage = 0;
      for (const [i, clip] of (addonMedia.bottom ?? []).entries()) {
        if (clip.source === "library" && footage >= timeline.duration + BOTTOM_LEAD_S) break;
        const content = clip.source === "library" ? await downloadLibraryFile(clip.path!) : await downloadMedia(clip.videoUrl!, "video");
        const ext = clip.source === "library" ? clip.path!.split(".").pop()!.toLowerCase() : "mp4";
        const duration = clip.duration ?? (await probeDuration(content, ext));
        // The first clip starts late enough for the loop shot; the others skip a short lead-in.
        const mediaStart = clip.mediaStart ?? (i === 0 ? BOTTOM_LEAD_S : 0.5);
        const file = `assets/bottom-${i}.${ext}`;
        extraFiles.push({ path: file, content });
        sources.push({ file, duration, mediaStart });
        footage += duration - mediaStart;
      }
      const bottom = sources.length
        ? planBottomShots(
            sources,
            timeline.duration,
            // Gameplay plays continuously; Pixabay clips are cut like the top, every ~12 s.
            addonMedia.bottom?.[0]?.source === "library" ? Infinity : SATISFYING_PIECE_S,
          )
        : undefined;

      // Pop-up photos (times were planned and saved in fetch-broll).
      const popups: NonNullable<CompositionExtras["popups"]> = [];
      for (const [i, p] of (addonMedia.popups ?? []).entries()) {
        const file = `assets/popup-${i}.jpg`;
        extraFiles.push({ path: file, content: await download(p.imagePath) });
        popups.push({ file, start: p.start, end: p.end, side: p.side, place: p.place });
      }

      const html = buildCompositionHtml(timeline, withMedia, {
        hookTitle: script?.hookTitle,
        credit: script?.sourceCredit,
        bottom,
        music,
        popups,
      });

      const dir = await writeProject(jobId, [
        { path: "index.html", content: html },
        { path: "hyperframes.json", content: JSON.stringify(HYPERFRAMES_JSON, null, 2) },
        ...audio,
        ...media,
        ...extraFiles,
      ]);
      await startRender(dir);
      return {
        dir,
        duration: timeline.duration,
        shots: shots.length,
        music: !!music,
        bottomShots: bottom?.length ?? 0,
        popups: popups.length,
      };
    });

    // Poll the detached render process; mirror its progress to the job for the page.
    const dir = projectDir(jobId); // deterministic, so safe outside a step
    let finished: { exitCode: number | null; logTail: string } | null = null;
    for (let i = 0; i < MAX_POLLS && !finished; i++) {
      await step.sleep(`wait-${i}`, POLL_EVERY);
      const status = await step.run(`check-${i}`, async () => {
        const s = await readRenderStatus(dir);
        await setJob(jobId, { render_progress: Math.min(99, Math.round(s.progress)) });
        return s;
      });
      if (status.done) finished = status;
    }

    if (!finished || finished.exitCode !== 0) {
      const why = finished ? `Render failed (exit ${finished.exitCode}):\n${finished.logTail}` : "Render timed out after 40 minutes.";
      await step.run("fail-render", () => setJob(jobId, { status: "failed", error: why }));
      return { jobId, ok: false };
    }

    const videoPath = await step.run("upload-video", async () => {
      const video = await readFile(path.join(dir, VIDEO_FILE));
      const storagePath = `${jobId}/video.mp4`;
      const { error } = await supabaseAdmin()
        .storage.from(MEDIA_BUCKET)
        .upload(storagePath, video, { contentType: "video/mp4", upsert: true });
      if (error) throw new Error(`Uploading the video failed: ${error.message}`);
      await setJob(jobId, { status: "rendered", render_progress: 100, video_path: storagePath });
      await rm(dir, { recursive: true, force: true });
      return storagePath;
    });

    return { jobId, ok: true, videoPath };
  },
);
