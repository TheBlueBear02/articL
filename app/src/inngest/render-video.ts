import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { inngest, VOICE_READY, type VoiceReadyData } from "./client";
import { ARTICLES_BUCKET, supabaseAdmin } from "@/lib/supabase/server";
import { setJob, MEDIA_BUCKET } from "@/lib/supabase/jobs-db";
import { searchPhotosCached, searchVideosCached } from "@/lib/pixabay";
import { downloadMedia, pickShotMedia } from "@/lib/pixabay-api";
import { choosePopupPhoto } from "./footage";
import type { TokenUsage } from "@/lib/pricing";
import { buildMapScene, findCountry, periodLabel, placeNames } from "@/render/map";
import {
  BOTTOM_LEAD_S,
  buildCompositionHtml,
  buildTimeline,
  FADE_S,
  HYPERFRAMES_JSON,
  LOOP_LEAD_S,
  planBottomShots,
  HALF_PX,
  planMap,
  planMusic,
  planPaperPage,
  CARD_HOLD_S,
  linkedinBusy,
  type LinkedinExtras,
  type PanelKind,
  type TimelineLayout,
  planPopups,
  planSfx,
  planShots,
  type SfxKind,
  withLoopEnding,
  type BottomSource,
  type CompositionExtras,
} from "@/render/composition";
import { coverTime, saveCover } from "@/render/cover";
import { renderPaperPage } from "@/render/paper-page";
import { extractFrame, extractThumbnail, probeDuration, projectDir, readRenderStatus, startRender, VIDEO_FILE, writeProject } from "@/render/local";
import { defaultRenderTarget, getCloudRender, startCloudRender, uploadZip, zipProject } from "@/lib/heygen";
import { saveTokens, saveUsage } from "@/lib/usage-db";
import { downloadLibraryFile, listGameplay, listMusic, pickFor, trackCredit } from "@/lib/library";
import {
  audienceOf,
  resolveAddons,
  type AddonMedia,
  type Addons,
  type AuthorInfo,
  type CandidatePoint,
  type PaperMeta,
  type BrollImage,
  type PopupMedia,
  type PreparedPopup,
  type RenderTarget,
  type Script,
  type Segment,
  type StudySetting,
} from "@/lib/jobs";

/** Split-screen "satisfying" footage: Pixabay searches that tested well (long clips, matching tags). */
const SATISFYING_QUERIES = ["marble run", "pottery wheel", "skateboarding", "snowboard", "roller coaster", "toy car racing"];
const SATISFYING_PIECE_S = 12;

/** Add-on choices; popups/sfx/map default on when missing (jobs from before migration 0005, or never saved). */
async function readAddons(jobId: string): Promise<Addons> {
  const { data, error } = await supabaseAdmin().from("jobs").select("addons, audience").eq("id", jobId).single();
  return resolveAddons(error ? null : ((data?.addons ?? null) as Addons | null), audienceOf(data ?? {}));
}

/** With the Data visuals add-on off, beats keep their plain big-number callout. */
function chartsIf(segments: Segment[], addons: Addons): Segment[] {
  return addons.charts === false ? segments.map((s) => ({ ...s, chart: undefined })) : segments;
}

async function readAddonMedia(jobId: string): Promise<AddonMedia> {
  const { data, error } = await supabaseAdmin().from("jobs").select("addon_media").eq("id", jobId).single();
  return error ? {} : ((data?.addon_media ?? {}) as AddonMedia);
}

/** LinkedIn's timeline layout and on-screen parts. Null for Social and Student videos (they loop). */
type LinkedinPlan = { layout: TimelineLayout; extras: LinkedinExtras; quoteSegments: number[] };

/**
 * LinkedIn videos: no loop (the closing card holds CARD_HOLD_S), a method diagram from the verified
 * study setting on the first method beat, "What it shows / What it doesn't" on the limitation beat,
 * the paper's own sentence under each finding, and a closing card with the paper's details. Built
 * from saved data only, so fetch-broll and start-render get the same layout.
 */
async function linkedinPlan(jobId: string, segments: Segment[]): Promise<LinkedinPlan | null> {
  const { data } = await supabaseAdmin()
    .from("jobs")
    .select("audience, candidate_points, study_setting, paper_meta, author_info, script")
    .eq("id", jobId)
    .single();
  if (!data || audienceOf(data) !== "academic") return null;
  const points = new Map(((data.candidate_points ?? []) as CandidatePoint[]).map((p) => [p.id, p]));
  const pointAt = (i: number) => (segments[i].kind === "beat" ? points.get(segments[i].pointId ?? "") : undefined);
  const setting = (data.study_setting ?? null) as StudySetting | null;
  const meta = (data.paper_meta ?? {}) as PaperMeta;
  const author = (data.author_info ?? {}) as AuthorInfo;
  const script = data.script as Script | null;

  const panels: Record<number, PanelKind> = {};
  const extras: LinkedinExtras = { card: { monogram: "" } };
  const method = (
    [
      ["Where", setting?.place?.value],
      ["When", setting?.period?.value],
      ["Who", setting?.sample?.value],
    ] as const
  ).flatMap(([label, value]) => (value ? [{ label, value }] : []));
  const methodAt = segments.findIndex((_, i) => pointAt(i)?.type === "method");
  if (methodAt >= 0 && method.length) {
    panels[methodAt] = "method";
    extras.method = method;
  }
  const limitAt = segments.findIndex((_, i) => pointAt(i)?.type === "limitation");
  const lead = points.get(script?.payoffPointId ?? "");
  if (limitAt >= 0 && lead) {
    panels[limitAt] = "verdict";
    extras.verdict = { shows: lead.text, doesnt: pointAt(limitAt)!.text };
  }
  // Findings: paper evidence for a short one-sentence on-screen popup (trimmed further in composition).
  extras.quotes = {};
  segments.forEach((_, i) => {
    const p = pointAt(i);
    if (p && ["stat", "claim", "quote"].includes(p.type) && !panels[i]) extras.quotes![i] = p.evidence.split(/\.{3}|…/)[0].trim();
  });

  const authors = meta.authors ?? [];
  const leadName = author.name || (authors.length > 2 ? `${authors[0]} et al.` : authors.join(" & "));
  extras.byline = [leadName, author.university, meta.journal, meta.year].filter(Boolean).join(" · ");
  extras.card = {
    title: meta.title,
    authors: authors.length > 4 ? `${authors.slice(0, 4).join(", ")} et al.` : authors.join(", ") || undefined,
    source: [meta.journal, meta.year].filter(Boolean).join(" · ") || undefined,
    doi: meta.doi,
    contact: author.name ? [author.name, author.role, author.university].filter(Boolean).join(" · ") : undefined,
    monogram: initials(author.name || authors[0] || meta.title || "ArticL"),
  };
  return {
    layout: { endHold: CARD_HOLD_S, panels },
    extras,
    quoteSegments: Object.keys(extras.quotes).map(Number),
  };
}

/** "Benjamin A. Olken" -> "BO". */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "A";
}

/** Jobs made from pasted text have no PDF (empty file_path). */
async function hasPdf(jobId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("jobs").select("file_path").eq("id", jobId).single();
  return !!data?.file_path;
}

/** The job's uploaded PDF (kept in the articles bucket since upload). */
async function downloadPdf(jobId: string): Promise<Uint8Array> {
  const { data: job, error } = await supabaseAdmin().from("jobs").select("file_path").eq("id", jobId).single();
  if (error || !job?.file_path) throw new Error(`Job ${jobId} has no PDF: ${error?.message ?? "pasted text"}`);
  const { data, error: dlError } = await supabaseAdmin().storage.from(ARTICLES_BUCKET).download(job.file_path);
  if (dlError || !data) throw new Error(`Downloading the PDF failed: ${dlError?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Where the map's country ends up on screen (px from the top): below the captions, above the Reels UI. */
const MAP_FOCUS_Y = 1420;

/** A sound effect: the user's own from library/sfx/<kind>.mp3 if uploaded, else the built-in one. */
async function sfxFile(kind: SfxKind): Promise<Buffer> {
  try {
    return await downloadLibraryFile(`sfx/${kind}.mp3`);
  } catch {
    return readFile(path.join(process.cwd(), "assets", "sfx", `${kind}.mp3`));
  }
}

/**
 * Pop-up photos: time each beat's pop-up word first (so no photo is used for a slot that can't be
 * shown). Each slot uses the photo picked while the voice was recorded (footage.ts), if it is for
 * the same word and not already a shot; otherwise it is picked now. A pop-up without a good photo
 * is skipped. Never fails the video.
 */
async function pickPopups(
  jobId: string,
  segments: Segment[],
  usedPhotos: Set<number>,
  place: string | undefined,
  busy: [number, number][],
  prepared: PreparedPopup[],
  /** Photo checks done here (pop-ups not prepared during the recording) add their tokens here. */
  checks: TokenUsage[],
  layout: TimelineLayout = {},
): Promise<PopupMedia[]> {
  const requests = segments.flatMap((s, segment) => (s.kind === "beat" && s.popup ? [{ segment, word: s.popup.word }] : []));
  const slots = planPopups(buildTimeline(segments, layout), requests, busy);
  const out: PopupMedia[] = [];
  for (const slot of slots) {
    const seg = segments[slot.segment];
    const popup = seg.popup!;
    try {
      const ready = prepared.find((p) => p.segment === slot.segment && p.word === popup.word && !usedPhotos.has(p.photo.id));
      const pick = ready ? { hit: ready.photo, query: ready.query } : await choosePopupPhoto(seg, place, usedPhotos, checks);
      if (!pick) continue;
      const { hit, query } = pick;
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

/** The cover the user picked while it rendered (/create flow), else 1 s in. */
async function chosenCoverTime(jobId: string): Promise<number> {
  const { data, error } = await supabaseAdmin().from("jobs").select("segments, cover_segment").eq("id", jobId).single();
  if (error || data?.cover_segment == null || !data.segments) return 1;
  return coverTime(data.segments as Segment[], data.cover_segment);
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
      // The temp project folder (audio, footage, the paper page image) isn't needed any more.
      await rm(projectDir(jobId), { recursive: true, force: true }).catch(() => {});
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as VoiceReadyData;

    await step.run("fetch-broll", async () => {
      await setJob(jobId, { status: "fetching_broll", render_progress: 0, error: null });
      const { data: job, error } = await supabaseAdmin().from("jobs").select("segments").eq("id", jobId).single();
      if (error || !job?.segments) throw new Error(`No voiceover segments for job ${jobId}`);
      // Charts take the callout band, so pop-ups are planned around them.
      const segments = chartsIf(job.segments as Segment[], await readAddons(jobId));
      // LinkedIn holds a closing card at the end, which changes the shot plan: same layout everywhere.
      const li = await linkedinPlan(jobId, segments);
      const layout = li?.layout ?? {};

      // ~3 s shots; each gets its segment's next shot search (older jobs: the one b-roll term).
      const shots = planShots(buildTimeline(segments, layout));
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
        const film = buildTimeline(segments, layout).duration;
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
      // The study's place drives the map and makes pop-up photo searches specific (migration 0007;
      // a missing column just means no place).
      const { data: s } = await supabaseAdmin().from("jobs").select("study_setting").eq("id", jobId).single();
      const setting = (s?.study_setting ?? null) as StudySetting | null;
      const place = setting?.place?.value;

      if (addons.map) {
        const country = findCountry(place);
        // The country and the place's own names ("Java", "Delhi"): the script may say either.
        const slot = country ? planMap(buildTimeline(segments, layout), [...country.words, ...placeNames(place)]) : null;
        if (country && slot) {
          addonMedia.map = { country: country.name, label: country.label, period: periodLabel(setting?.period?.value), ...slot };
        }
      }
      // Paper page: only the timing is saved here; the image is drawn from the PDF at render time.
      // LinkedIn: panels, quoted findings and the closing card hold the band, so overlays wait.
      const liBusy = li ? linkedinBusy(buildTimeline(segments, layout), li.quoteSegments) : [];
      if (addons.paperPage && (await hasPdf(jobId))) {
        const mapBusy: [number, number][] = addonMedia.map ? [[addonMedia.map.start, addonMedia.map.end]] : [];
        const slot = planPaperPage(buildTimeline(segments, layout), [...mapBusy, ...liBusy]);
        if (slot) addonMedia.paperPage = { page: 1, ...slot };
      }
      if (addons.popups) {
        const usedPhotos = new Set(picks.filter((p) => p.kind === "image").map((p) => p.hit.id));
        const busy: [number, number][] = [
          ...(addonMedia.map ? [[addonMedia.map.start, addonMedia.map.end] as [number, number]] : []),
          ...(addonMedia.paperPage ? [[addonMedia.paperPage.start, addonMedia.paperPage.end] as [number, number]] : []),
          ...liBusy,
        ];
        const prepared = (await readAddonMedia(jobId)).preparedPopups ?? [];
        const checks: TokenUsage[] = [];
        addonMedia.popups = await pickPopups(jobId, segments, usedPhotos, place, busy, prepared, checks, layout);
        await saveTokens(jobId, "footage:checks", checks);
      }
      // Always written: it also replaces the pop-ups prepared while the voice was recorded.
      await setJob(jobId, { addon_media: addonMedia });

      return {
        shots: broll.length,
        videos: broll.filter((b) => b.kind === "video").length,
        music: addonMedia.music?.path ?? null,
        bottom: addonMedia.bottom?.length ?? 0,
        popups: addonMedia.popups?.map((p) => `${p.word} @ ${p.start}s (${p.query})`) ?? [],
        map: addonMedia.map ? `${addonMedia.map.label} ${addonMedia.map.period} @ ${addonMedia.map.start}s` : null,
      };
    });

    const started = await step.run("start-render", async () => {
      await setJob(jobId, { status: "rendering", render_progress: 0 });
      const { data: job, error } = await supabaseAdmin()
        .from("jobs")
        .select("segments, broll, script")
        .eq("id", jobId)
        .single();
      if (error || !job) throw new Error(`Job ${jobId} not found: ${error?.message}`);
      const segments = chartsIf(job.segments as Segment[], await readAddons(jobId));
      const broll = job.broll as BrollImage[];
      const script = job.script as Script | null;

      // Same deterministic plan (and LinkedIn layout) as in fetch-broll, so shot g lines up with broll[g].
      const li = await linkedinPlan(jobId, segments);
      const timeline = buildTimeline(segments, li?.layout ?? {});
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
      const shotsWithMedia = shots.map((sh, g) => ({
        ...sh,
        media: {
          kind: broll[g].kind === "video" ? ("video" as const) : ("image" as const),
          file: media[g].path,
          mediaStart: broll[g].mediaStart,
        },
      }));
      // LinkedIn ends on the closing card, so it doesn't loop back to the first shot.
      const withMedia = li ? shotsWithMedia : withLoopEnding(shotsWithMedia, timeline.duration);
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

      // Map intro: drawn now from the saved country; on split screen it covers the bottom half.
      let map: CompositionExtras["map"];
      if (addonMedia.map) {
        const m = addonMedia.map;
        const scene = bottom ? buildMapScene(m.country, HALF_PX, MAP_FOCUS_Y - HALF_PX) : buildMapScene(m.country, 1920, MAP_FOCUS_Y);
        map = { ...scene, start: m.start, end: m.end, label: m.period ? `${m.label} · ${m.period}` : m.label };
      }

      // Paper page: drawn from the PDF straight into the temp project folder, which is deleted after
      // the render; never uploaded to Storage. A page that can't be drawn is left out.
      let paperPage: CompositionExtras["paperPage"];
      if (addonMedia.paperPage) {
        const pp = addonMedia.paperPage;
        try {
          const file = `assets/paper-page-${pp.page}.jpg`;
          extraFiles.push({ path: file, content: await renderPaperPage(await downloadPdf(jobId), pp.page) });
          paperPage = { file, start: pp.start, end: pp.end };
        } catch (e) {
          console.warn(`[render-video] no paper page for ${jobId}: ${e instanceof Error ? e.message : e}`);
        }
      }

      // Sound effects, timed to the final pop-ups (and paper page), callouts, beats and map.
      let sfx: CompositionExtras["sfx"];
      const addons = await readAddons(jobId);
      if (addons.sfx) {
        const cues = planSfx(timeline, paperPage ? [...popups, paperPage] : popups, map);
        const files: Partial<Record<SfxKind, string>> = {};
        for (const kind of new Set(cues.map((c) => c.kind))) {
          files[kind] = `assets/sfx-${kind}.mp3`;
          extraFiles.push({ path: files[kind], content: await sfxFile(kind) });
        }
        sfx = { files, cues };
      }

      const html = buildCompositionHtml(timeline, withMedia, {
        hookTitle: script?.hookTitle,
        credit: script?.sourceCredit,
        bottom,
        music,
        popups,
        map,
        paperPage,
        sfx,
        linkedin: li?.extras,
      });

      const dir = await writeProject(jobId, [
        { path: "index.html", content: html },
        { path: "hyperframes.json", content: JSON.stringify(HYPERFRAMES_JSON, null, 2) },
        ...audio,
        ...media,
        ...extraFiles,
      ]);
      // This computer (free) or HeyGen Cloud (paid per minute): the job's choice, else RENDER_MODE.
      const target: RenderTarget = (await readAddons(jobId)).render ?? defaultRenderTarget();
      if (target === "local") await startRender(dir);
      // Each part's first shot, for the build tracker's thumbnails (/create flow).
      const blocks = segments.map((_, i) => {
        const g = shots.findIndex((sh) => sh.segment === i);
        return g < 0 ? null : { file: media[g].path, video: broll[g].kind === "video", at: broll[g].mediaStart ?? 0 };
      });
      return {
        target,
        dir,
        blocks,
        duration: timeline.duration,
        shots: shots.length,
        music: !!music,
        bottomShots: bottom?.length ?? 0,
        popups: popups.length,
        map: !!map,
        paperPage: !!paperPage,
        sfx: sfx?.cues.map((c) => `${c.kind}@${c.start}`) ?? [],
      };
    });

    const dir = projectDir(jobId); // deterministic, so safe outside a step
    // /create flow: one small frame per script part, shown in the build tracker while it renders.
    await step.run("block-thumbs", async () => {
      const { data } = await supabaseAdmin().from("jobs").select("flow").eq("id", jobId).single();
      if (data?.flow !== "create") return { skipped: true };
      const paths: (string | null)[] = [];
      for (const [i, b] of started.blocks.entries()) {
        if (!b) {
          paths.push(null);
          continue;
        }
        try {
          const frame = await extractFrame(path.join(dir, b.file), b.video ? b.at + 0.5 : null);
          const storagePath = `${jobId}/block-${i}.jpg`;
          const { error } = await supabaseAdmin()
            .storage.from(MEDIA_BUCKET)
            .upload(storagePath, frame, { contentType: "image/jpeg", upsert: true });
          if (error) throw new Error(error.message);
          paths.push(storagePath);
        } catch (e) {
          console.warn(`[render-video] no thumbnail for part ${i} of ${jobId}: ${e instanceof Error ? e.message : e}`);
          paths.push(null);
        }
      }
      await setJob(jobId, { block_thumbs: paths });
      return { thumbs: paths.filter(Boolean).length };
    });
    if (started.target === "cloud") return renderInCloud(jobId, dir, step);

    // Poll the detached render process; mirror its progress to the job for the page.
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
      // The home page carousel's card: free and under a second (the video is already on disk).
      // A missing thumbnail never fails the job; the card then shows the hook title instead.
      try {
        const thumb = await extractThumbnail(path.join(dir, VIDEO_FILE), await chosenCoverTime(jobId));
        const { error: thumbError } = await supabaseAdmin()
          .storage.from(MEDIA_BUCKET)
          .upload(`${jobId}/thumb.jpg`, thumb, { contentType: "image/jpeg", upsert: true });
        if (thumbError) throw new Error(thumbError.message);
      } catch (e) {
        console.warn(`[render-video] no thumbnail for ${jobId}: ${e instanceof Error ? e.message : e}`);
      }
      await setJob(jobId, { status: "rendered", render_progress: 100, video_path: storagePath });
      await rm(dir, { recursive: true, force: true });
      return storagePath;
    });

    return { jobId, ok: true, videoPath };
  },
);

/** How often to check a cloud render, and for how long at most (40 minutes, as locally). */
const CLOUD_POLLS = 120;

/**
 * Render the project folder on HeyGen Cloud: zip and upload it, start the render, poll every 20 s,
 * then copy the MP4 and HeyGen's thumbnail into Storage (HeyGen's links are short-lived and its
 * retention isn't documented). A cloud failure fails the job with HeyGen's own reason: it never
 * falls back to the local render, so it's always clear which one ran.
 */
async function renderInCloud(
  jobId: string,
  dir: string,
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<unknown>; sleep: (id: string, d: string) => Promise<unknown> },
) {
  const renderId = (await step.run("cloud-submit", async () => {
    const zip = await zipProject(dir);
    // The job id as idempotency key: an Inngest retry reuses the same upload and render (no double bill).
    const assetId = await uploadZip(zip, `articl-${jobId}.zip`, `articl-upload-${jobId}`);
    const id = await startCloudRender(assetId, `ArticL ${jobId}`, `articl-render-${jobId}`);
    console.log(`[render-video] cloud render ${id} for ${jobId} (zip ${(zip.length / 1e6).toFixed(1)} MB)`);
    return id;
  })) as string;

  let result: Awaited<ReturnType<typeof getCloudRender>> | null = null;
  for (let i = 0; i < CLOUD_POLLS && !result; i++) {
    await step.sleep(`cloud-wait-${i}`, POLL_EVERY);
    const r = (await step.run(`cloud-check-${i}`, () => getCloudRender(renderId))) as Awaited<ReturnType<typeof getCloudRender>>;
    if (r.status === "completed" || r.status === "failed") result = r;
  }

  if (!result || result.status === "failed" || !result.video_url) {
    const why = !result
      ? "Cloud render timed out after 40 minutes."
      : `Cloud render failed${result.failure_code ? ` (${result.failure_code})` : ""}: ${result.failure_message ?? "no video returned"}${result.failure_detail ? ` — ${result.failure_detail}` : ""}`;
    await step.run("fail-render", () => setJob(jobId, { status: "failed", error: why }));
    return { jobId, ok: false, target: "cloud" as const };
  }

  const done = result;
  const videoPath = (await step.run("upload-video", async () => {
    const fetchBytes = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Downloading from HeyGen failed (${res.status}).`);
      return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
    };
    const storage = supabaseAdmin().storage.from(MEDIA_BUCKET);
    const video = await fetchBytes(done.video_url!);
    const storagePath = `${jobId}/video.mp4`;
    const { error } = await storage.upload(storagePath, video.bytes, { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`Uploading the video failed: ${error.message}`);
    // HeyGen's thumbnail becomes the home page carousel's card (never fails the job).
    if (done.thumbnail_url) {
      try {
        const thumb = await fetchBytes(done.thumbnail_url);
        // Always image/jpeg: HeyGen serves it as binary/octet-stream, which the media bucket refuses.
        const { error: thumbError } = await storage.upload(`${jobId}/thumb.jpg`, thumb.bytes, { contentType: "image/jpeg", upsert: true });
        if (thumbError) throw new Error(thumbError.message);
      } catch (e) {
        console.warn(`[render-video] no thumbnail for ${jobId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Billed per minute of output video (the timing panel shows the estimate).
    if (done.duration) await saveUsage(jobId, "render:cloud", { renderSeconds: done.duration });
    // /create flow: a cover the user picked while it rendered replaces HeyGen's thumbnail.
    const { data: picked } = await supabaseAdmin().from("jobs").select("cover_segment").eq("id", jobId).single();
    if (picked?.cover_segment != null) {
      await saveCover(jobId, { bytes: video.bytes }, await chosenCoverTime(jobId)).catch((e) =>
        console.warn(`[render-video] cover not saved for ${jobId}: ${e instanceof Error ? e.message : e}`),
      );
    }
    await setJob(jobId, { status: "rendered", render_progress: 100, video_path: storagePath });
    await rm(dir, { recursive: true, force: true });
    return storagePath;
  })) as string;

  return { jobId, ok: true, target: "cloud" as const, videoPath };
}
