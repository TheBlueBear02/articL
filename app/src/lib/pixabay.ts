import "server-only";
import { supabaseAdmin } from "./supabase/server";
import { cleanQuery, fetchPhotos, fetchVideos, type PhotoHit, type VideoHit } from "./pixabay-api";

// Pixabay API rules (https://pixabay.com/api/docs/): results must be cached for 24 h, no
// permanent hotlinking of images (we store our own copy), and show users where media comes from.
// 100 requests / 60 s per key. The plain API calls and media picking live in ./pixabay-api.
const CACHE_HOURS = 24;

async function cached<T>(key: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  const { data } = await supabaseAdmin().from("pixabay_cache").select("hits, fetched_at").eq("query", key).maybeSingle();
  if (data && (Date.now() - new Date(data.fetched_at).getTime()) / 3_600_000 < CACHE_HOURS) return data.hits as T[];

  const hits = await fetcher();
  const { error } = await supabaseAdmin()
    .from("pixabay_cache")
    .upsert({ query: key, hits, fetched_at: new Date().toISOString() });
  if (error) console.warn(`Pixabay cache write failed (continuing): ${error.message}`);
  return hits;
}

// Cache keys are prefixed so photo and video results for the same words don't collide
// (and so older entries, which lack tags or the type/preview fields, aren't reused).
export const searchPhotosCached = (q: string): Promise<PhotoHit[]> =>
  cached(`photos4:${cleanQuery(q)}`, () => fetchPhotos(cleanQuery(q)));

export const searchVideosCached = (q: string): Promise<VideoHit[]> =>
  cached(`videos:${cleanQuery(q)}`, () => fetchVideos(cleanQuery(q)));
