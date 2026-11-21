import { MUSIC_MOODS, RENDER_TARGETS, SPLIT_STYLES, type Addons } from "@/lib/jobs";
import { cloudRenderAvailable } from "@/lib/heygen";
import { libraryInfo } from "@/lib/library";

/**
 * Checks add-on choices sent by the page: { music?: "calm" | "upbeat" | "dramatic",
 * split?: "gameplay" | "satisfying", gameplayClip?: string, popups?: boolean, sfx?: boolean, map?: boolean,
 * charts?: boolean }.
 * Returns the cleaned choices, or an error message for a 400.
 */
export async function parseAddons(raw: unknown): Promise<{ addons: Addons } | { error: string }> {
  const input = (raw ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || Array.isArray(input)) return { error: "addons must be an object." };
  const addons: Addons = {};
  if (input.music != null) {
    if (!MUSIC_MOODS.includes(input.music as never)) return { error: `music must be one of: ${MUSIC_MOODS.join(", ")}.` };
    addons.music = input.music as Addons["music"];
  }
  if (input.split != null) {
    if (!SPLIT_STYLES.includes(input.split as never)) return { error: `split must be one of: ${SPLIT_STYLES.join(", ")}.` };
    addons.split = input.split as Addons["split"];
  }
  if (input.gameplayClip != null) {
    if (typeof input.gameplayClip !== "string" || addons.split !== "gameplay") {
      return { error: 'gameplayClip needs split "gameplay" and a clip path.' };
    }
    addons.gameplayClip = input.gameplayClip;
  }
  for (const key of ["popups", "sfx", "map", "charts"] as const) {
    if (input[key] == null) continue;
    if (typeof input[key] !== "boolean") return { error: `${key} must be true or false.` };
    // Keep false so "Off" is stored; missing keys stay default-on via resolveAddons.
    addons[key] = input[key] as boolean;
  }
  if (input.render != null) {
    if (!RENDER_TARGETS.includes(input.render as never)) return { error: `render must be one of: ${RENDER_TARGETS.join(", ")}.` };
    if (input.render === "cloud" && !cloudRenderAvailable()) return { error: "Cloud rendering isn't set up (no HEYGEN_API_KEY)." };
    addons.render = input.render as Addons["render"];
  }
  // Library-backed choices need files in the library (Pixabay "satisfying" clips don't).
  if (addons.music || addons.split === "gameplay") {
    const lib = await libraryInfo().catch(() => null);
    if (addons.music && !lib?.music[addons.music]) return { error: `There is no ${addons.music} music in the library yet.` };
    if (addons.split === "gameplay" && !lib?.gameplay) return { error: "There are no gameplay clips in the library yet." };
    if (addons.gameplayClip && !lib?.gameplayClips.some((c) => c.path === addons.gameplayClip)) {
      return { error: "That gameplay clip isn't in the library (it may have been removed)." };
    }
  }
  return { addons };
}
