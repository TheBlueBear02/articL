import { supabaseAdmin } from "@/lib/supabase/server";
import { searchPhotosCached, searchVideosCached } from "@/lib/pixabay";
import { cleanQuery, photoCandidates, placeSearchWords, type PhotoHit } from "@/lib/pixabay-api";
import { pickPhoto } from "@/lib/openai";
import { audienceOf, resolveAddons, type Addons, type PreparedPopup, type Script, type StudySetting } from "@/lib/jobs";
import { scriptSegments } from "@/lib/script";
import { saveTokens, tokensOf } from "@/lib/usage-db";
import type { TokenUsage } from "@/lib/pricing";

/** At most this many AI photo checks per pop-up (one per search tried). */
const MAX_PHOTO_CHECKS = 2;

/** The parts of a segment the footage search needs (no audio yet). */
type SearchPart = { kind: "hook" | "beat" | "closing"; text: string; broll: string; shots?: string[]; popup?: { word: string; query: string } };

/**
 * One pop-up photo: search Pixabay most specific first (the study's place + the search, the
 * search, the word). Real photos whose tags strictly match go to a vision model, which picks the
 * one that fits the word and the study's setting, or rejects them all.
 * Testing (tags only): a Bavarian church for "villages" in Afghanistan, a Christmas scene for
 * "household income". Returns null when no photo fits.
 */
export async function choosePopupPhoto(
  part: SearchPart,
  place: string | undefined,
  usedPhotos: Set<number>,
  /** Each photo check's tokens are added here (shown as the footage step's usage). */
  usage: TokenUsage[] = [],
): Promise<{ hit: PhotoHit; query: string } | null> {
  const popup = part.popup;
  if (!popup?.word) return null;
  const where = placeSearchWords(place);
  const searches = [where && `${where} ${popup.query}`, popup.query, popup.word].map((q) => cleanQuery(q || ""));
  let checks = 0;
  for (const q of [...new Set(searches.filter(Boolean))]) {
    const candidates = photoCandidates(await searchPhotosCached(q), q, usedPhotos);
    if (!candidates.length) continue;
    if (checks >= MAX_PHOTO_CHECKS) break;
    checks++;
    try {
      // Testing: searched as the bare word "test", the check accepted a COVID test for "driving test".
      const pick = await pickPhoto({ word: popup.word, meant: popup.query || popup.word, sentence: part.text, place, imageUrls: candidates.map((c) => c.webformatURL!) });
      usage.push(tokensOf(pick.model, pick.usage));
      console.log(`[footage] pop-up "${popup.word}" / "${q}": ${pick.index < 0 ? "none fit" : `photo ${pick.index + 1}`} (${pick.reason})`);
      if (pick.index < 0) continue;
      return { hit: candidates[pick.index], query: q };
    } catch (e) {
      // Without the check, fall back to the best tag match rather than lose the pop-up.
      console.warn(`[footage] photo check failed for "${popup.word}": ${e instanceof Error ? e.message : e}`);
      return { hit: candidates[0], query: q };
    }
  }
  return null;
}

/**
 * Runs while the voice is recorded: every Pixabay search the script asks for (so the footage step
 * after the voice reads them from the cache) and each beat's pop-up photo check. The footage step
 * only fits these to the recorded timing. Never throws: anything missing is simply searched later.
 * Testing: footage search took 17-28 s after the voice; the searches only need the script.
 */
export async function prefetchFootage(jobId: string, script: Script, round = 1): Promise<{ searches: number; popups: number }> {
  const parts = scriptSegments(script) as SearchPart[];
  // The same searches pickShotMedia may try: each shot search, its first 2 words, the topic, and the
  // generic filler. Testing: without the 2-word versions, the footage step still spent ~7 s searching.
  const shotSearches = parts.flatMap((p) => p.shots ?? []);
  const queries = new Set(
    [...shotSearches, ...shotSearches.map((q) => q.split(/\s+/).slice(0, 2).join(" ")), ...parts.map((p) => p.broll), "city life"]
      .map((q) => cleanQuery(q || ""))
      .filter(Boolean),
  );
  // pickShotMedia tries videos first, then photos, for each search.
  await Promise.all(
    [...queries].map((q) =>
      Promise.all([searchVideosCached(q), searchPhotosCached(q)]).catch((e) =>
        console.warn(`[footage] prefetch "${q}" failed: ${e instanceof Error ? e.message : e}`),
      ),
    ),
  );

  const { data: job } = await supabaseAdmin().from("jobs").select("addons, audience").eq("id", jobId).single();
  const addons = resolveAddons((job?.addons ?? null) as Addons | null, audienceOf(job ?? {}));
  if (!addons.popups) return { searches: queries.size, popups: 0 };

  const { data: s } = await supabaseAdmin().from("jobs").select("study_setting").eq("id", jobId).single();
  const place = ((s?.study_setting ?? null) as StudySetting | null)?.place?.value;
  // One check per beat, in parallel; the same photo isn't used twice.
  const checks: TokenUsage[] = [];
  const picks = await Promise.all(
    parts.map(async (part, segment): Promise<PreparedPopup | null> => {
      if (part.kind !== "beat" || !part.popup?.word) return null;
      const pick = await choosePopupPhoto(part, place, new Set(), checks).catch(() => null);
      return pick && { segment, word: part.popup.word, query: pick.query, photo: pick.hit };
    }),
  );
  const seen = new Set<number>();
  const prepared = picks.filter((p): p is PreparedPopup => !!p && !seen.has(p.photo.id) && !!seen.add(p.photo.id));
  await supabaseAdmin().from("jobs").update({ addon_media: { preparedPopups: prepared } }).eq("id", jobId);
  await saveTokens(jobId, `footage:prefetch:${round}`, checks);
  return { searches: queries.size, popups: prepared.length };
}
