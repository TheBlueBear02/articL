import "server-only";
// The add-ons library: files added by hand in Supabase Storage -> "library" (see 0005_addons.sql).
import { supabaseAdmin } from "./supabase/server";
import { MUSIC_MOODS, type LibraryInfo, type MusicMood } from "./jobs";

export const LIBRARY_BUCKET = "library";

const MUSIC_EXT = /\.(mp3|m4a|aac|wav)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

/** File paths in one library folder that match the extension (folders and placeholders skipped). */
async function listFiles(folder: string, ext: RegExp): Promise<string[]> {
  const { data, error } = await supabaseAdmin().storage.from(LIBRARY_BUCKET).list(folder, { limit: 200 });
  if (error) {
    // No bucket yet (migration 0005 not run): treat as empty rather than failing the page.
    if (/not found/i.test(error.message)) return [];
    throw new Error(`Listing library/${folder} failed: ${error.message}`);
  }
  return (data ?? [])
    .filter((f) => f.id && ext.test(f.name))
    .map((f) => `${folder}/${f.name}`)
    .sort();
}

export const listMusic = (mood: MusicMood) => listFiles(`music/${mood}`, MUSIC_EXT);
export const listGameplay = () => listFiles("gameplay", VIDEO_EXT);

/** "gameplay/minecraft-parkour_1min.mp4" -> "minecraft parkour 1min" */
export function clipName(path: string): string {
  return path.split("/").pop()!.replace(VIDEO_EXT, "").replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();
}

const PREVIEW_LINK_S = 60 * 60;

export async function libraryInfo(): Promise<LibraryInfo> {
  const [counts, gameplay] = await Promise.all([
    Promise.all(MUSIC_MOODS.map(async (m) => [m, (await listMusic(m)).length] as const)),
    listGameplay(),
  ]);
  // Signed links so the points screen can show a small preview of each clip (the bucket is private).
  const signed = gameplay.length
    ? await supabaseAdmin().storage.from(LIBRARY_BUCKET).createSignedUrls(gameplay, PREVIEW_LINK_S)
    : { data: [] };
  const gameplayClips = gameplay.map((path, i) => ({
    path,
    name: clipName(path),
    previewUrl: signed.data?.[i]?.signedUrl ?? undefined,
  }));
  return {
    music: Object.fromEntries(counts) as Record<MusicMood, number>,
    gameplay: gameplay.length,
    gameplayClips,
  };
}

/** "music/upbeat/Sunny Day -- Jane Doe.mp3" -> { title: "Sunny Day", artist: "Jane Doe" } */
export function trackCredit(path: string): { title: string; artist?: string } {
  const name = path.split("/").pop()!.replace(MUSIC_EXT, "").replace(/[_]+/g, " ").trim();
  const [title, artist] = name.split(/\s+--\s+/);
  return { title: title.trim(), artist: artist?.trim() || undefined };
}

/** Stable pick from a list, so a job always gets the same file (retries render the same video). */
export function pickFor(jobId: string, items: string[], salt = ""): string | undefined {
  if (!items.length) return undefined;
  let h = 0;
  for (const c of jobId + salt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return items[h % items.length];
}

export async function downloadLibraryFile(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin().storage.from(LIBRARY_BUCKET).download(path);
  if (error || !data) throw new Error(`Downloading library/${path} failed: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}
