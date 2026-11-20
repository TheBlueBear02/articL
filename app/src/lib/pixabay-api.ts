// Plain Pixabay API calls (no caching, no server-only imports) so they can also be used from
// test scripts. app/src/lib/pixabay.ts wraps these with the 24 h cache Pixabay requires.
// Docs: https://pixabay.com/api/docs/

export type PhotoHit = {
  id: number;
  largeImageURL: string;
  pageURL: string;
  user: string;
  tags: string;
  /** 640 px version, for the AI photo check (older cache entries don't have it). */
  webformatURL?: string;
  /** "photo", "illustration" or "vector" (Pixabay's image_type filter lets some drawings through). */
  type?: string;
  isLowQuality?: boolean;
};

/** Drawings and 3D renders look out of place next to stock footage. Testing: a cartoon street came
 *  back for "village market" despite image_type=photo. */
const NOT_A_PHOTO = /\b(illustration|cartoon|drawing|vector|clipart|clip art|3d|render|rendering|comic|painting|sketch|icon)\b/i;
export const isRealPhoto = (h: PhotoHit) =>
  (h.type ?? "photo") === "photo" && !h.isLowQuality && !NOT_A_PHOTO.test(h.tags);

type VideoFile = { url: string; width: number; height: number; size: number };
export type VideoHit = {
  id: number;
  pageURL: string;
  user: string;
  tags: string;
  duration: number;
  videos: { large: VideoFile; medium: VideoFile; small: VideoFile; tiny: VideoFile };
};

export function cleanQuery(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function apiKey(): string {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new Error("PIXABAY_API_KEY is not set");
  return key;
}

async function getJson(url: URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay search failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/** Portrait, safe-search photos. */
export async function fetchPhotos(query: string): Promise<PhotoHit[]> {
  const url = new URL("https://pixabay.com/api/");
  url.search = new URLSearchParams({
    key: apiKey(),
    q: query,
    image_type: "photo",
    orientation: "vertical",
    safesearch: "true",
    // 30, not 10: most hits fail the tag match, and the pop-up photo check needs choices.
    per_page: "30",
  }).toString();
  const json = await getJson(url);
  return (json.hits ?? []).map((h: PhotoHit) => ({
    id: h.id,
    largeImageURL: h.largeImageURL,
    pageURL: h.pageURL,
    user: h.user,
    tags: h.tags ?? "",
    webformatURL: h.webformatURL,
    type: h.type,
    isLowQuality: h.isLowQuality,
  }));
}

/** Safe-search stock videos (Pixabay has no orientation filter for video). */
export async function fetchVideos(query: string): Promise<VideoHit[]> {
  const url = new URL("https://pixabay.com/api/videos/");
  url.search = new URLSearchParams({
    key: apiKey(),
    q: query,
    video_type: "film",
    safesearch: "true",
    per_page: "15",
  }).toString();
  const json = await getJson(url);
  return (json.hits ?? []).map((h: VideoHit) => ({
    id: h.id,
    pageURL: h.pageURL,
    user: h.user,
    tags: h.tags ?? "",
    duration: h.duration,
    videos: h.videos,
  }));
}

/** Never download more than this per clip. */
const MAX_VIDEO_BYTES = 30_000_000;

/**
 * Pick the file to download: the 1080p version ("medium", 1920x1080 or 1080x1920 for portrait
 * clips), never 4K. 4K sources tripled render time in testing (3m45s -> 11m15s for a 52 s reel)
 * and HyperFrames' performance guide says larger sources add decode work. Trade-off: a landscape
 * 1080p clip is centre-cropped to ~608 px wide and scaled up, so it looks softer than 4K would.
 * Falls back to the 720p ("small") file if there is no 1080p one.
 */
export function chooseVideoFile(hit: VideoHit): VideoFile | null {
  const is1080 = (f: VideoFile) => Math.min(f.width, f.height) >= 1000 && Math.max(f.width, f.height) <= 1920;
  const files = [hit.videos.medium, hit.videos.small, hit.videos.large].filter(
    (f) => f?.url && f.size > 0 && f.size <= MAX_VIDEO_BYTES,
  );
  return files.find(is1080) ?? files.find((f) => Math.max(f.width, f.height) <= 1920) ?? null;
}

export const isPortrait = (hit: VideoHit) => {
  const f = hit.videos.medium ?? hit.videos.large;
  return !!f && f.height > f.width;
};

/** query: this shot's search; topic: its segment's broader topic ("pension policy"). */
export type ShotRequest = { query: string; topic?: string; length: number };
export type ShotPick =
  | { kind: "video"; query: string; hit: VideoHit; file: VideoFile; mediaStart: number }
  | { kind: "image"; query: string; hit: PhotoHit };

const STOPWORDS = new Set(
  "a an the and or of in on at to for with by from up down over under people person man woman close closeup shot view background".split(" "),
);

/** Key words of a query, singularised a little so "coins" matches the tag "coin". */
function keywords(query: string): string[] {
  return cleanQuery(query)
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(?<!s)s$/, ""));
}

/**
 * How well a hit's tags match the query: the number of the query's key words found in its tags.
 * Pixabay returns loosely related popular results for multi-word queries (testing: "hands holding
 * money" -> a cigarette, "pension paperwork" -> a bee), so hits with no matching key word are dropped.
 */
export function relevance(query: string, tags: string, mode: "strict" | "loose" = "strict"): number {
  const tagWords = new Set(cleanQuery(tags).split(" ").map((w) => w.replace(/(ies)$/, "y").replace(/(?<!s)s$/, "")));
  const keys = keywords(query);
  if (!keys.length) return 0;
  const matched = keys.filter((k) => tagWords.has(k)).length;
  // The main noun is usually last ("stock CHART", "hands holding MONEY", "voting BOOTH") and must
  // always match. Strict mode also needs most of the query: testing showed "hands holding money"
  // matching a cigarette clip on "hand"+"holding", and "trading screen" a rabbit on a green screen.
  // Loose mode (used only when strict finds nothing) accepts the main noun alone, so
  // "stacked coins" can still find a clip tagged just "coin".
  const head = keys[keys.length - 1];
  if (!tagWords.has(head)) return 0;
  if (mode === "strict" && matched < Math.min(keys.length, 2)) return 0;
  return matched;
}

/** Up to `max` pop-up candidates for a search: unused real photos whose tags strictly match, best first. */
export function photoCandidates(hits: PhotoHit[], query: string, used: Set<number>, max = 6): PhotoHit[] {
  return hits
    .filter((h) => !used.has(h.id) && h.webformatURL && isRealPhoto(h) && relevance(query, h.tags) > 0)
    .sort((a, b) => relevance(query, b.tags) - relevance(query, a.tags))
    .slice(0, max);
}

/**
 * Words of a study's place that make a photo search more specific: the capitalized names in
 * "250 villages across Afghanistan" -> "afghanistan". Empty when the place has no names.
 */
export function placeSearchWords(place: string | undefined): string {
  return cleanQuery((place ?? "").match(/\b[A-Z][a-zA-Z]+\b/g)?.join(" ") ?? "");
}

/** Skip the first moment of a clip (often a fade-in or camera settle). */
const CLIP_LEAD_IN_S = 0.5;

/**
 * Choose media for each shot: a stock video clip long enough to cover the shot (portrait clips
 * first), otherwise a photo. Never reuses a clip or photo within one video. Hits must match the
 * search by tags (see relevance); fallbacks are tried in the order explained below.
 * Search functions are passed in so the server can add caching.
 */
export async function pickShotMedia(
  shots: ShotRequest[],
  fallbackTopic: string,
  search: { videos: (q: string) => Promise<VideoHit[]>; photos: (q: string) => Promise<PhotoHit[]> },
  extraSeconds = 0.5, // fade overlap etc.
  /** Start the FIRST shot's clip this much later, so the film's loop shot can play the seconds before it. */
  firstShotLeadS = 0,
): Promise<ShotPick[]> {
  const usedVideos = new Set<number>();
  const usedPhotos = new Set<number>();
  const picks: ShotPick[] = [];
  // Each distinct query is searched once per video (Pixabay allows 100 requests a minute,
  // and shots often share fallback queries).
  const memo = new Map<string, Promise<[VideoHit[], PhotoHit[]]>>();
  const searchBoth = (q: string) => {
    if (!memo.has(q)) memo.set(q, Promise.all([search.videos(q), search.photos(q)]));
    return memo.get(q)!;
  };

  for (const [index, shot] of shots.entries()) {
    const q = shot.query || shot.topic || fallbackTopic;
    const leadIn = CLIP_LEAD_IN_S + (index === 0 ? firstShotLeadS : 0);
    // Order matters, learned in testing:
    // - a loose own-query match ("polling STATION" -> a subway) is worse than a strict match on the
    //   segment's topic, so all strict "on-topic" searches come first;
    // - but a loose own-query match ("pension DOCUMENT" -> a notebook) beats generic filler, so the
    //   video's general topic and "city life" come last.
    // - topics are abstract ("pension policy", "political values"), so they never get a loose
    //   match: that found a Wi-Fi router tagged "privacy policy" and a gold coin tagged "real values".
    const own = [q, q.split(/\s+/).slice(0, 2).join(" ")].map(cleanQuery).filter(Boolean);
    const topic = cleanQuery(shot.topic ?? "");
    const generic = [fallbackTopic, "city life"].map(cleanQuery).filter(Boolean);
    const plan: [string, "strict" | "loose"][] = [];
    const seen = new Set<string>();
    const add = (query: string, mode: "strict" | "loose") => {
      if (!query || seen.has(mode + query)) return;
      plan.push([query, mode]);
      seen.add(mode + query);
    };
    own.forEach((x) => add(x, "strict"));
    add(topic, "strict");
    own.forEach((x) => add(x, "loose"));
    generic.forEach((x) => add(x, "strict"));
    generic.forEach((x) => add(x, "loose"));

    const need = shot.length + extraSeconds + leadIn;
    let pick: ShotPick | null = null;

    // Within each step: a video before a photo.
    search: for (const [query, mode] of plan) {
      {
        const [videoHits, photoHits] = await searchBoth(query);
        const videos = videoHits
          .filter((h) => !usedVideos.has(h.id) && h.duration >= need && relevance(query, h.tags, mode) > 0)
          .sort(
            (a, b) =>
              relevance(query, b.tags, mode) - relevance(query, a.tags, mode) ||
              Number(isPortrait(b)) - Number(isPortrait(a)),
          );
        for (const hit of videos) {
          const file = chooseVideoFile(hit);
          if (file) {
            pick = { kind: "video", query, hit, file, mediaStart: leadIn };
            break search;
          }
        }
        const photo = photoHits
          .filter((h) => !usedPhotos.has(h.id) && isRealPhoto(h) && relevance(query, h.tags, mode) > 0)
          .sort((a, b) => relevance(query, b.tags, mode) - relevance(query, a.tags, mode))[0];
        if (photo) {
          pick = { kind: "image", query, hit: photo };
          break search;
        }
      }
    }
    if (!pick) {
      // Last resort: any unused photo for the general topic, rather than failing the video.
      const photo = (await search.photos(cleanQuery(fallbackTopic))).find((h) => !usedPhotos.has(h.id));
      if (photo) pick = { kind: "image", query: fallbackTopic, hit: photo };
    }
    if (!pick) throw new Error(`No Pixabay video or photo found for "${q}" or its fallbacks.`);
    if (pick.kind === "video") usedVideos.add(pick.hit.id);
    else usedPhotos.add(pick.hit.id);
    picks.push(pick);
  }
  return picks;
}

const looksLikeImage = (b: Buffer) =>
  (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47);
// MP4 files have "ftyp" at bytes 4-7.
const looksLikeMp4 = (b: Buffer) => b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp";

/**
 * Download a photo or video. Pixabay's CDN throttles bursts with a short "Rate limit exceeded"
 * body (seen in testing), so retry with growing waits and check the bytes are real media.
 */
export async function downloadMedia(url: string, kind: "image" | "video", attempts = 5): Promise<Buffer> {
  const ok = kind === "image" ? looksLikeImage : looksLikeMp4;
  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.ok && ok(buf)) return buf;
    last = `HTTP ${res.status}: ${buf.subarray(0, 60).toString("utf8").trim()}`;
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
  }
  throw new Error(`Downloading ${kind} failed after ${attempts} tries (${last}).`);
}
