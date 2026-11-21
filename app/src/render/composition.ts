// Build the HyperFrames composition (index.html) for a voiced job.
// Pure (no runtime deps besides ./align) so it can be tested with plain node.
//
// Structure: the film is a list of SHOTS (~3 s each, cut on caption boundaries). Each shot is a
// photo or a muted stock-video clip inside an untimed wrapper; motion and fades are animated on
// the wrapper because HyperFrames forbids tweening opacity/visibility on clip elements.
import type { Segment, Word } from "../lib/jobs";
import { alignToScript } from "./align";

/** Keep this much air after a segment's last spoken word before the next one starts. */
const TAIL_PAD_S = 0.25;
/**
 * Extra time after the voice ends. 0 for a seamless loop: a freeze at the end makes the restart obvious
 * (the segment's TAIL_PAD_S already keeps the last word from being clipped).
 */
const END_HOLD_S = 0;
/** The loop shot at the end of the film (reuses the first shot's media) normally lasts this long... */
const LOOP_SHOT_S = 1.5;
/** ...and never longer than this. The first clip is started this much later, so the loop shot can play
 * the seconds just before it and end on exactly the frame the film opens on. */
export const LOOP_LEAD_S = 2.6;
/** The hook title is on screen for the first seconds, then fades back in at the loop point. */
const TITLE_HOLD_S = 3.0;
const TITLE_RETURN_S = 0.4;
/** Aim for a cut about this often (Reels typically cut every 2-4 s). */
const TARGET_SHOT_S = 3.0;
const MIN_SHOT_S = 1.6;
const MAX_SHOTS_PER_SEGMENT = 4;
/** Cross-fade length; the outgoing shot stays visible this long under the incoming one. */
export const FADE_S = 0.35;
/** How long a number callout stays up after the number is spoken. */
const CALLOUT_HOLD_S = 3.0;
/** Pop-up photos: on screen this long, starting just before their word, with this much air between them. */
const POPUP_S = 1.8;
const POPUP_MIN_S = 1.2;
const POPUP_LEAD_S = 0.1;
const POPUP_GAP_S = 1.0;
/** A pop-up may start this much after its word, to wait for a callout or the title to clear. */
const POPUP_MAX_DELAY_S = 0.6;

export type TimelineSegment = {
  index: number;
  kind: Segment["kind"];
  start: number; // seconds on the film timeline
  length: number; // seconds this segment's audio slot lasts
  audioFile: string; // relative to the project folder
  words: Word[]; // script spelling, film-timeline times
  /** Student videos: the on-screen section label ("THE QUESTION"). */
  section?: string;
};

export type Timeline = { segments: TimelineSegment[]; duration: number };

export type Shot = {
  segment: number;
  shot: number; // index within its segment
  start: number;
  length: number; // visible slot, not counting the fade overlap
};

export type ShotMedia = { kind: "image" | "video"; file: string; mediaStart?: number };

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Lay segments end to end, trimming each one's trailing silence (TTS adds ~0.3-1 s).
 * Word times are shifted onto the film timeline.
 */
export function buildTimeline(segments: Segment[]): Timeline {
  let t = 0;
  const out: TimelineSegment[] = segments.map((seg, index) => {
    const lastWordEnd = seg.words.length ? Math.max(...seg.words.map((w) => w.end)) : seg.duration;
    const length = round(Math.min(seg.duration, lastWordEnd + TAIL_PAD_S));
    const start = round(t);
    t += length;
    return {
      index,
      kind: seg.kind,
      start,
      length,
      audioFile: `assets/seg-${index}.mp3`,
      ...(seg.section ? { section: seg.section } : {}),
      // Script spelling ("7.5", "2,703"), Whisper timing.
      words: alignToScript(seg.text, seg.words).map((w) => ({
        word: w.word,
        start: round(start + w.start),
        end: round(start + w.end),
      })),
    };
  });
  return { segments: out, duration: round(t + END_HOLD_S) };
}

/**
 * Split each segment into ~3 s shots, moving each cut to the nearest word start so a cut never
 * lands mid-word. The last shot of the film runs through the end hold.
 */
export function planShots(timeline: Timeline): Shot[] {
  const shots: Shot[] = [];
  const last = timeline.segments.length - 1;
  for (const seg of timeline.segments) {
    const segEnd = seg.index === last ? timeline.duration : seg.start + seg.length;
    const span = segEnd - seg.start;
    const n = Math.max(1, Math.min(MAX_SHOTS_PER_SEGMENT, Math.round(span / TARGET_SHOT_S)));
    const wordStarts = seg.words.map((w) => w.start).filter((s) => s > seg.start + MIN_SHOT_S && s < segEnd - MIN_SHOT_S);

    const cuts: number[] = [];
    for (let k = 1; k < n; k++) {
      const ideal = seg.start + (span * k) / n;
      const snapped = wordStarts.length
        ? wordStarts.reduce((best, s) => (Math.abs(s - ideal) < Math.abs(best - ideal) ? s : best))
        : ideal;
      const prev = cuts.at(-1) ?? seg.start;
      if (snapped - prev >= MIN_SHOT_S && segEnd - snapped >= MIN_SHOT_S) cuts.push(snapped);
    }

    const bounds = [seg.start, ...cuts, segEnd];
    for (let k = 0; k < bounds.length - 1; k++) {
      shots.push({ segment: seg.index, shot: k, start: round(bounds[k]), length: round(bounds[k + 1] - bounds[k]) });
    }
  }
  return shots;
}

/** How long a section label stays up, and the shortest worth showing. */
export const SECTION_S = 2.2;
const SECTION_MIN_S = 1;

/**
 * Student videos: a section label ("HOW THEY TESTED IT") when a new section starts. Two method
 * beats in a row share one label. Never in the loop seconds at the end, so the replay stays clean.
 */
export function planSections(timeline: Timeline): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const lastAllowed = timeline.duration - LOOP_LEAD_S;
  let previous: string | undefined;
  for (const s of timeline.segments) {
    if (s.section && s.section !== previous) {
      const end = round(Math.min(s.start + SECTION_S, lastAllowed));
      if (end - s.start >= SECTION_MIN_S) out.push({ text: s.section, start: s.start, end });
    }
    previous = s.section;
  }
  return out;
}

/** Short names for the top-left section list (the full label shows above the captions). */
const SECTION_SHORT: Record<string, string> = {
  "THE QUESTION": "Question",
  "HOW THEY TESTED IT": "How tested",
  "WHAT THEY FOUND": "Findings",
  "WHY IT MATTERS": "Why it matters",
};

export type SectionList = { items: string[]; marks: { item: number; start: number }[]; show: number; hide: number };

/**
 * Student videos: the list of sections in the top-left corner, with the current one marked as it
 * starts. It appears once the hook title is gone and leaves before the loop seconds, so the replay
 * (which starts without it) stays seamless. Null when the video has no sections.
 */
export function planSectionList(timeline: Timeline): SectionList | null {
  const show = round(titleOffAt(timeline) + 0.2);
  const hide = round(timeline.duration - LOOP_LEAD_S - 0.3);
  const items: string[] = [];
  const marks: { item: number; start: number }[] = [];
  let previous: string | undefined;
  for (const s of timeline.segments) {
    if (s.section && s.section !== previous) {
      const name = SECTION_SHORT[s.section] ?? s.section;
      if (!items.includes(name)) items.push(name);
      if (s.start < hide) marks.push({ item: items.indexOf(name), start: round(Math.max(s.start, show)) });
    }
    previous = s.section;
  }
  return items.length && hide - show > 2 ? { items, marks, show, hide } : null;
}

export type Callout = { main: string; sub: string; start: number; end: number };

/**
 * One big-number callout per beat that speaks a number: "7.5" + "percentage points",
 * "9 to 12 percent" -> "9–12%". Shown from when the number is spoken.
 */
export function findCallouts(timeline: Timeline): Callout[] {
  const out: Callout[] = [];
  for (const seg of timeline.segments) {
    if (seg.kind !== "beat") continue;
    const w = seg.words;
    const i = w.findIndex((x) => /\d/.test(x.word));
    if (i < 0) continue;
    let main = w[i].word.replace(/[^\d.,$£€%]/g, "");
    let j = i + 1;
    // "9 to 12" -> "9–12"
    if (w[j]?.word.toLowerCase() === "to" && /\d/.test(w[j + 1]?.word ?? "")) {
      main += "–" + w[j + 1].word.replace(/[^\d.,%]/g, "");
      j += 2;
    }
    // "percentage points" is not "%": keep it as a label. Check it before plain "percent".
    const sub: string[] = [];
    if (/^percentage$/i.test(w[j]?.word ?? "") && /^points?/i.test(w[j + 1]?.word ?? "")) {
      sub.push("percentage points");
      j += 2;
    } else if (/^percent$/i.test(w[j]?.word ?? "")) {
      main += "%";
      j++;
    }
    const segEnd = seg.start + seg.length;
    out.push({
      main,
      sub: sub.join(" "),
      start: w[i].start,
      end: round(Math.min(segEnd, w[i].start + CALLOUT_HOLD_S)),
    });
  }
  return out;
}

/** When the hook title leaves the screen (it's back for the last TITLE_RETURN_S of the film). */
function titleOffAt(timeline: Timeline): number {
  const hook = timeline.segments.find((s) => s.kind === "hook");
  return round(Math.min(TITLE_HOLD_S, hook ? hook.start + hook.length : TITLE_HOLD_S, timeline.duration / 2));
}

export type PopupRequest = { segment: number; word: string };
/** "high": the band above the captions; "low": a smaller card below them, used while a number callout is up. */
export type PopupPlace = "high" | "low";
export type PopupSlot = PopupRequest & { start: number; end: number; side: "left" | "right"; place: PopupPlace };

const plainWord = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']+/g, "");

/**
 * When and where each pop-up photo shows: from just before its word is spoken, for POPUP_S.
 * It goes in the band above the captions ("high"), which it shares with the hook title and the
 * number callouts. If a callout is up, it moves below the captions ("low") instead. It may wait
 * briefly for the title to clear, never runs into the loop seconds at the end, and keeps a gap from
 * the previous pop-up. Requests whose word can't be found in the timed words are skipped.
 */
export function planPopups(
  timeline: Timeline,
  requests: PopupRequest[],
  /** Extra windows with no pop-ups at all (e.g. while the map intro is on screen). */
  busy: [number, number][] = [],
): PopupSlot[] {
  const D = timeline.duration;
  const always: [number, number][] = [
    [0, titleOffAt(timeline) + 0.3],
    [D - LOOP_LEAD_S - 0.3, D],
    ...busy.map(([a, b]): [number, number] => [a - 0.2, b + 0.2]),
  ];
  const callouts = findCallouts(timeline).map((c): [number, number] => [c.start - 0.2, c.end + 0.2]);
  const out: PopupSlot[] = [];

  // Earliest start at or after `from` that keeps POPUP_MIN_S clear of the blocks, and its end.
  const fit = (from: number, segEnd: number, blocked: [number, number][]) => {
    let start = from;
    for (let moved = true; moved; ) {
      moved = false;
      for (const [a, b] of blocked) {
        if (start < b && start + POPUP_MIN_S > a) {
          start = b;
          moved = true;
        }
      }
    }
    // End early rather than run into something that starts later in the beat.
    const nextBlock = Math.min(...blocked.map(([a]) => a).filter((a) => a >= start));
    return { start, end: Math.min(start + POPUP_S, segEnd, nextBlock) };
  };

  for (const req of [...requests].sort((a, b) => a.segment - b.segment)) {
    const seg = timeline.segments[req.segment];
    if (!seg) continue;
    const want = req.word.split(/\s+/).map(plainWord).filter(Boolean);
    const words = seg.words.map((w) => plainWord(w.word));
    const at = words.findIndex((_, i) => want.every((x, k) => words[i + k] === x));
    if (!want.length || at < 0) continue;

    const wordStart = Math.max(seg.start, seg.words[at].start - POPUP_LEAD_S);
    const from = Math.max(wordStart, out.length ? out[out.length - 1].end + POPUP_GAP_S : 0);
    const segEnd = seg.start + seg.length;
    const ok = (s: { start: number; end: number }) => s.start - wordStart <= POPUP_MAX_DELAY_S && s.end - s.start >= POPUP_MIN_S;
    let place: PopupPlace = "high";
    let slot = fit(from, segEnd, [...always, ...callouts]);
    if (!ok(slot)) {
      place = "low";
      slot = fit(from, segEnd, always);
    }
    if (!ok(slot)) continue;
    out.push({ ...req, start: round(slot.start), end: round(slot.end), side: out.length % 2 === 0 ? "left" : "right", place });
  }
  return out;
}

// ---- Map intro ----
/** The map is on screen this long, from just before the place is said in the first beat. */
const MAP_S = 2.8;
const MAP_MIN_S = 1.6;

/**
 * When the map intro shows: as the place is first said ("Afghan", "England", "Java"), anywhere in
 * the script once the hook title is gone, matched on the first 5 letters of `placeWords` (the
 * country and the study place's own names). At the start of the first beat if it's never said.
 * Null when there's no beat or no room before the loop seconds.
 * Testing (Olken): the map listened for "Indonesia" in the first beat only; the script said "Java"
 * (hook and beat 1, 13 s later), so the map showed at the beat's start instead.
 */
export function planMap(timeline: Timeline, placeWords: string[]): { start: number; end: number } | null {
  const firstBeat = timeline.segments.find((s) => s.kind === "beat");
  if (!firstBeat) return null;
  const earliest = titleOffAt(timeline) + 0.3;
  const latest = timeline.duration - LOOP_LEAD_S - 0.3 - MAP_MIN_S;
  const prefixes = [...new Set(placeWords.map((w) => plainWord(w).slice(0, 5)).filter((p) => p.length >= 4))];
  const said = timeline.segments
    .flatMap((s) => s.words)
    .find((w) => w.start - 0.15 >= earliest && w.start - 0.15 <= latest && prefixes.some((p) => plainWord(w.word).startsWith(p)));
  const start = round(said ? said.start - 0.15 : Math.max(firstBeat.start + 0.2, earliest));
  const end = round(Math.min(start + MAP_S, timeline.duration - LOOP_LEAD_S - 0.3));
  return end - start >= MAP_MIN_S ? { start, end } : null;
}

// ---- Sound effects ----
export const SFX_KINDS = ["pop", "ding", "whoosh"] as const;
export type SfxKind = (typeof SFX_KINDS)[number];
export type SfxCue = { kind: SfxKind; start: number };
/** Length of each built-in sound, and how loud it plays (voice = 1; ~0.1-0.3 is -20 to -10 dB). */
const SFX: Record<SfxKind, { length: number; volume: number; priority: number }> = {
  ding: { length: 0.9, volume: 0.18, priority: 3 },
  pop: { length: 0.2, volume: 0.3, priority: 2 },
  whoosh: { length: 0.5, volume: 0.22, priority: 1 },
};
/** Two sounds closer than this would blur together; the more important one is kept. */
const SFX_MIN_GAP_S = 0.4;

/**
 * Sound effects timed to what's already on screen: a pop for each pop-up photo, a ding for each
 * number callout, and a whoosh at most twice: when the map appears and when the last beat (the
 * payoff) starts. None in the hook-title seconds or the loop seconds at the end, so the replay
 * stays seamless.
 */
export function planSfx(timeline: Timeline, popups: { start: number }[], map?: { start: number } | null): SfxCue[] {
  const D = timeline.duration;
  const quietFrom = D - LOOP_LEAD_S - 0.3;
  // Testing: a whoosh on every beat was too much, so only the two moments that matter get one.
  const payoffBeat = timeline.segments.filter((s) => s.kind === "beat").at(-1);
  const cues: SfxCue[] = [
    ...findCallouts(timeline).map((c) => ({ kind: "ding" as const, start: c.start })),
    ...popups.map((p) => ({ kind: "pop" as const, start: p.start })),
    ...(map ? [{ kind: "whoosh" as const, start: map.start }] : []),
    ...(payoffBeat ? [{ kind: "whoosh" as const, start: payoffBeat.start }] : []),
  ].filter((c) => c.start >= titleOffAt(timeline) && c.start + SFX[c.kind].length <= quietFrom);

  const kept: SfxCue[] = [];
  for (const cue of cues.sort((a, b) => a.start - b.start)) {
    const last = kept[kept.length - 1];
    if (last && cue.start - last.start < SFX_MIN_GAP_S) {
      if (SFX[cue.kind].priority > SFX[last.kind].priority) kept[kept.length - 1] = cue;
      continue;
    }
    kept.push(cue);
  }
  return kept.map((c) => ({ ...c, start: round(c.start) }));
}

export type ShotWithMedia = Shot & { media: ShotMedia; loop?: boolean };

/**
 * Seamless loop: end the film on a "loop shot" that shows the first shot's media just BEFORE the
 * moment the film opens on, so the last frame flows into the first frame when the reel replays.
 * The final shot is split (its last LOOP_SHOT_S becomes the loop shot) or, if it is too short to
 * split, replaced. Videos rely on the first clip starting LOOP_LEAD_S late (see pickShotMedia).
 */
export function withLoopEnding(shots: ShotWithMedia[], filmDuration: number): ShotWithMedia[] {
  if (!shots.length) return shots;
  const first = shots[0];
  const last = shots[shots.length - 1];
  const lastEnd = round(Math.min(filmDuration, last.start + last.length));
  const splits = last.length >= LOOP_SHOT_S + 1.0;
  // A single shot (e.g. one long gameplay clip) can only loop by splitting off its own tail.
  if (shots.length === 1 && !splits) return shots;
  const loopLen = round(Math.min(LOOP_LEAD_S, splits ? LOOP_SHOT_S : last.length));
  const loopStart = round(lastEnd - loopLen);
  const mediaStart =
    first.media.kind === "video" ? round(Math.max(0, (first.media.mediaStart ?? 0) - loopLen)) : undefined;
  const loopShot: ShotWithMedia = {
    segment: last.segment,
    shot: splits ? last.shot + 1 : last.shot,
    start: loopStart,
    length: round(lastEnd - loopStart),
    media: { ...first.media, mediaStart },
    loop: true,
  };
  const head = shots.slice(0, -1);
  return splits ? [...head, { ...last, length: round(loopStart - last.start) }, loopShot] : [...head, loopShot];
}

type Transform = { scale: number; xPercent: number };
type Motion = { from: Transform; to: Transform; dur: number };

/** Deterministic variety (HyperFrames compositions may not use Math.random). */
const IMAGE_MOTIONS: Record<string, [Transform, Transform]> = {
  zoomIn: [{ scale: 1.0, xPercent: 0 }, { scale: 1.14, xPercent: 0 }],
  panLeft: [{ scale: 1.12, xPercent: 3 }, { scale: 1.12, xPercent: -3 }],
  zoomOut: [{ scale: 1.14, xPercent: 0 }, { scale: 1.0, xPercent: 0 }],
  panRight: [{ scale: 1.12, xPercent: -3 }, { scale: 1.12, xPercent: 3 }],
};
const IMAGE_ORDER = ["zoomIn", "panLeft", "zoomOut", "panRight"];
const DRIFT: [Transform, Transform] = [{ scale: 1.0, xPercent: 0 }, { scale: 1.05, xPercent: 0 }];
// The first shot starts zoomed in a little, so the loop shot can arrive at it with the same slow
// zoom (running the zoom "backwards in time" from 1.0 would show the frame's edges).
const OPENING: [Transform, Transform] = [{ scale: 1.06, xPercent: 0 }, { scale: 1.12, xPercent: 0 }];

/** Each shot's wrapper motion. The loop shot continues into the first shot's starting state. */
export function shotMotions(shots: ShotWithMedia[]): Motion[] {
  const motions: Motion[] = shots.map((s, g) => {
    const [from, to] =
      g === 0 ? OPENING : s.media.kind === "video" ? DRIFT : IMAGE_MOTIONS[IMAGE_ORDER[g % IMAGE_ORDER.length]];
    return { from, to, dur: round(s.length + FADE_S) };
  });
  shots.forEach((s, g) => {
    if (!s.loop || g === 0) return;
    const f = motions[0];
    // Same speed as the opening motion, ending exactly where it begins.
    const k = s.length / f.dur;
    const back = (a: number, b: number) => round(a - (b - a) * k);
    motions[g] = {
      from: { scale: Math.max(1, back(f.from.scale, f.to.scale)), xPercent: back(f.from.xPercent, f.to.xPercent) },
      to: f.from,
      dur: s.length,
    };
  });
  return motions;
}

// ---- Split screen (bottom half) ----

/** Height of each half in split-screen mode (1920 / 2). */
export const HALF_PX = 960;
/** Lead-in for the bottom half's first clip: the loop shot needs this much footage before it. */
export const BOTTOM_LEAD_S = LOOP_LEAD_S + 0.5;

export type BottomSource = { file: string; duration: number; mediaStart: number };

/**
 * Fill the whole film with bottom-half footage: pieces of at most maxPieceS, cycling through the
 * sources and continuing where each source left off. Then end on a loop shot (see withLoopEnding),
 * which relies on sources[0].mediaStart >= BOTTOM_LEAD_S.
 */
export function planBottomShots(sources: BottomSource[], filmDuration: number, maxPieceS: number): ShotWithMedia[] {
  if (!sources.length) return [];
  const cursor = sources.map((s) => s.mediaStart);
  const shots: ShotWithMedia[] = [];
  let t = 0;
  let k = 0;
  let idle = 0; // sources in a row with nothing left; stop if all are used up
  while (filmDuration - t > 0.05) {
    const i = k % sources.length;
    const left = sources[i].duration - cursor[i] - 0.2;
    const len = round(Math.min(filmDuration - t, maxPieceS, left));
    // A piece shorter than 1 s would just flash; rewind that source and try the next one.
    if (len < Math.min(1, filmDuration - t)) {
      cursor[i] = 0.5;
      if (++idle > sources.length) throw new Error("Bottom-half clips are too short to fill the video.");
      k++;
      continue;
    }
    idle = 0;
    shots.push({
      segment: -1,
      shot: shots.length,
      start: round(t),
      length: len,
      media: { kind: "video", file: sources[i].file, mediaStart: round(cursor[i]) },
    });
    cursor[i] += len;
    t += len;
    k++;
  }
  return withLoopEnding(shots, filmDuration);
}

// ---- Background music ----

const MUSIC_VOLUME = 0.12; // ~ -18 dB: a bed under the voice (HyperFrames' own default for BGM)
const MUSIC_START_S = 3.0; // start this far into the track, leaving room for the loop tail
const MUSIC_XFADE_S = 0.3;

export type MusicClip = { start: number; duration: number; mediaStart: number; fadeIn?: number; fadeOut?: number };

/**
 * Two pieces of one track. The main piece plays from MUSIC_START_S; the tail plays the
 * LOOP_SHOT_S just before MUSIC_START_S, so at the film's end the music arrives exactly where it
 * starts and the replay continues seamlessly. The one jump (main -> tail) is cross-faded.
 * Returns null if the track is too short to cover the film.
 */
export function planMusic(trackDuration: number, filmDuration: number): MusicClip[] | null {
  const tail = LOOP_SHOT_S + MUSIC_XFADE_S;
  const mainLen = round(filmDuration - LOOP_SHOT_S);
  if (mainLen <= 1 || trackDuration < MUSIC_START_S + mainLen + 0.1) return null;
  return [
    { start: 0, duration: mainLen, mediaStart: MUSIC_START_S, fadeOut: MUSIC_XFADE_S },
    { start: round(mainLen - MUSIC_XFADE_S), duration: round(tail), mediaStart: round(MUSIC_START_S - tail), fadeIn: MUSIC_XFADE_S },
  ];
}

export type CompositionExtras = {
  hookTitle?: string;
  credit?: string;
  /** Split screen: footage for the bottom half (from planBottomShots). */
  bottom?: ShotWithMedia[];
  /** Background music file (relative to the project) and its pieces (from planMusic). */
  music?: { file: string; clips: MusicClip[] };
  /** Pop-up photos (file relative to the project) with their slots from planPopups. */
  popups?: { file: string; start: number; end: number; side: "left" | "right"; place?: PopupPlace }[];
  /** Sound effects: one file per kind (relative to the project) and the cues from planSfx. */
  sfx?: { files: Partial<Record<SfxKind, string>>; cues: SfxCue[] };
  /** Map intro: the scene from buildMapScene and its slot from planMap. */
  map?: MapScene & { start: number; end: number; label: string };
};

/**
 * A map zooming from the whole world into one country (built by render/map.ts). Coordinates are in
 * the SVG's own units; the zoom animates the viewBox, so the vector map stays sharp at every frame.
 */
export type MapScene = {
  /** <svg> markup, viewBox set to `from`. */
  svg: string;
  /** Height of the map panel: the full frame, or the bottom half on split screen. */
  height: number;
  /** World point at the screen's centre-ish focus at the start, and the country centre at the end. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Zoom at the end (the start is 1: the whole world across the frame width). */
  scale: number;
  /** Where the country ends up on screen, inside the panel. */
  focusY: number;
  /** Pin at the country centre, in world units at the final zoom. */
  pin: { x: number; y: number; r: number };
};

/** JSON that is safe to inline inside a <script> tag. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const fadesInto = (globalIndex: number) => globalIndex > 0 && globalIndex % 2 === 1;

export function buildCompositionHtml(
  timeline: Timeline,
  shots: ShotWithMedia[],
  extras: CompositionExtras = {},
): string {
  const D = timeline.duration;
  const motions = shotMotions(shots);
  const bottom = extras.bottom ?? [];
  const split = bottom.length > 0;
  const bottomMotions = shotMotions(bottom);

  // Bottom half: muted clips on their own tracks, motion on untimed wrappers like the top shots.
  const bottomHtml = bottom
    .map((s, g) => {
      const overlap = g + 1 < bottom.length && fadesInto(g + 1) ? FADE_S : 0;
      const len = round(Math.min(D - s.start, s.length + overlap));
      return `      <div id="b${g}" class="bshot" style="z-index:${g + 1}"><video id="bm${g}" class="clip media" src="${s.media.file}" muted playsinline data-start="${s.start}" data-duration="${len}" data-media-start="${s.media.mediaStart ?? 0}" data-track-index="${9 + (g % 2)}"></video></div>`;
    })
    .join("\n");

  const musicHtml = (extras.music?.clips ?? [])
    .map(
      (c, i) =>
        `      <audio id="music-${i}" src="${extras.music!.file}" data-start="${c.start}" data-duration="${c.duration}" data-media-start="${c.mediaStart}" data-volume="${MUSIC_VOLUME}"${c.fadeIn ? ` data-fade-in="${c.fadeIn}"` : ""}${c.fadeOut ? ` data-fade-out="${c.fadeOut}"` : ""} data-track-index="${11 + i}"></audio>`,
    )
    .join("\n");
  const titleOff = titleOffAt(timeline);

  // Pop-up photos: timed image clips inside untimed wrappers that carry the pop animation.
  const popups = extras.popups ?? [];
  const popupHtml = popups
    .map(
      (p, i) =>
        `      <div id="p${i}" class="popup popup-${p.side} popup-${p.place ?? "high"}"><img id="pm${i}" class="clip media" src="${p.file}" alt="" data-start="${p.start}" data-duration="${round(p.end - p.start)}" data-track-index="${20 + (i % 2)}" /></div>`,
    )
    .join("\n");

  const shotHtml = shots
    .map((s, g) => {
      // The outgoing shot stays up under a fade-in, so extend it when the next cut fades.
      const overlap = g + 1 < shots.length && fadesInto(g + 1) ? FADE_S : 0;
      const len = round(Math.min(D - s.start, s.length + overlap));
      const id = `m${g}`;
      const media =
        s.media.kind === "video"
          ? `<video id="${id}" class="clip media" src="${s.media.file}" muted playsinline data-start="${s.start}" data-duration="${len}" data-media-start="${s.media.mediaStart ?? 0}" data-track-index="${g % 2}"></video>`
          : `<img id="${id}" class="clip media" src="${s.media.file}" alt="" data-start="${s.start}" data-duration="${len}" data-track-index="${g % 2}" />`;
      return `      <div id="w${g}" class="shot" style="z-index:${g + 1}">${media}</div>`;
    })
    .join("\n");

  // Sound effects: short audio clips, rotated over 3 tracks (cues are ≥0.4 s apart, sounds ≤0.9 s).
  const sfxHtml = (extras.sfx?.cues ?? [])
    .filter((c) => extras.sfx?.files[c.kind])
    .map((c, i) => {
      const len = round(Math.min(SFX[c.kind].length, D - c.start));
      return `      <audio id="sfx-${i}" src="${extras.sfx!.files[c.kind]}" data-start="${c.start}" data-duration="${len}" data-volume="${SFX[c.kind].volume}" data-track-index="${30 + (i % 3)}"></audio>`;
    })
    .join("\n");

  // Map intro: a timed panel holding the SVG; the zoom is driven from the script below.
  const map = extras.map;
  const mapHtml = map
    ? `      <div id="mapwrap"${split ? ' class="split-map"' : ""}><div id="mapintro" class="clip" data-start="${map.start}" data-duration="${round(map.end - map.start)}" data-track-index="22">${map.svg}<div id="maplabel"></div></div></div>`
    : "";

  const audio = timeline.segments
    .map(
      (s) =>
        `      <audio id="voice-${s.index}" src="${s.audioFile}" data-start="${s.start}" data-duration="${s.length}" data-track-index="3"></audio>`,
    )
    .join("\n");

  const data = {
    shots: shots.map((s, g) => ({ start: s.start, ...motions[g], fadeIn: fadesInto(g) })),
    bottom: bottom.map((s, g) => ({ start: s.start, ...bottomMotions[g], fadeIn: fadesInto(g) })),
    words: timeline.segments.map((s) => s.words),
    callouts: findCallouts(timeline),
    sections: planSections(timeline),
    sectionList: planSectionList(timeline),
    fade: FADE_S,
    title: extras.hookTitle?.trim() || null,
    titleOff,
    titleBack: round(D - TITLE_RETURN_S),
    credit: extras.credit?.trim() || null,
    popups: popups.map((p) => ({ start: p.start, end: p.end, tilt: p.side === "left" ? -4 : 4 })),
    map: map
      ? {
          start: map.start,
          end: map.end,
          label: map.label,
          height: map.height,
          from: map.from,
          to: map.to,
          scale: map.scale,
          focusY: map.focusY,
          pin: map.pin,
        }
      : null,
  };

  return `<!doctype html>
<html lang="en" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      :root {
        --ground: #0b0b0f;
        --ink: #ffffff;
        --accent: #ffd60a;
        --font-display: "Montserrat", sans-serif;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: var(--ground); }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: var(--font-display); }
      /* Untimed wrappers carry motion + fades; the timed media inside fills them. */
      .shot { position: absolute; inset: 0; overflow: hidden; transform-origin: 50% 45%; }
      .media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      /* Split screen: the story footage fills the top half, the bottom half shows gameplay or
         "satisfying" clips. Captions sit across the dividing line. */
      .split .shot { inset: 0 0 ${HALF_PX}px 0; transform-origin: 50% 50%; }
      .bshot { position: absolute; left: 0; right: 0; top: ${HALF_PX}px; height: ${HALF_PX}px; overflow: hidden; }
      #divider { position: absolute; z-index: 800; left: 0; right: 0; top: ${HALF_PX - 3}px; height: 6px; background: #000; }
      /* Darken the middle band so captions stay readable on any photo or clip. */
      #scrim {
        position: absolute; inset: 0; z-index: 900;
        background: linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.7) 42%,
          rgba(0,0,0,0.7) 66%, rgba(0,0,0,0.25) 80%, rgba(0,0,0,0.1) 100%);
      }
      /* Inside the Instagram Reels safe area (bottom UI and side buttons). */
      #captions { position: absolute; z-index: 1000; left: 140px; right: 140px; top: 820px; height: 360px; }
      .chunk {
        position: absolute; inset: 0; display: flex; flex-wrap: wrap;
        align-content: center; justify-content: center; gap: 0 28px; visibility: hidden;
      }
      .word {
        display: inline-block; color: var(--ink); font-size: 84px; font-weight: 800; line-height: 1.1;
        text-transform: uppercase; letter-spacing: -0.01em; text-shadow: 0 6px 24px rgba(0,0,0,0.6);
      }
      /* Big-number callout above the captions. */
      #callouts { position: absolute; z-index: 1000; left: 140px; right: 140px; top: 330px; height: 420px; }
      .callout {
        position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
        justify-content: center; visibility: hidden;
      }
      .callout .num {
        background: var(--accent); color: #111; font-weight: 900; font-size: 168px; line-height: 1;
        padding: 18px 44px 22px; border-radius: 28px; letter-spacing: -0.03em;
        box-shadow: 0 18px 50px rgba(0,0,0,0.45);
      }
      .callout .sub {
        margin-top: 22px; color: var(--ink); font-weight: 800; font-size: 46px; text-transform: uppercase;
        letter-spacing: 0.02em; text-shadow: 0 4px 18px rgba(0,0,0,0.8);
      }
      /* Hook title: same band as the callouts (the hook has none), below the top UI zone. */
      #titlecard {
        position: absolute; z-index: 1001; left: 110px; right: 110px; top: 360px; height: 380px;
        display: flex; align-items: center; justify-content: center;
      }
      .title {
        background: rgba(0,0,0,0.62); color: var(--ink); font-weight: 900; font-size: 78px; line-height: 1.05;
        text-transform: uppercase; text-align: center; letter-spacing: -0.02em; padding: 26px 38px 30px;
        border-radius: 26px; border-bottom: 10px solid var(--accent); box-shadow: 0 18px 50px rgba(0,0,0,0.4);
      }
      /* Pop-up photos: a tilted card in the band above the captions (inside the top half on split screen). */
      .popup {
        position: absolute; z-index: 950; top: 350px; width: 420px; height: 420px; overflow: hidden;
        border: 12px solid #fff; border-radius: 30px; background: #fff; opacity: 0;
        box-shadow: 0 22px 60px rgba(0,0,0,0.55); transform-origin: 50% 60%;
      }
      .popup .media { border-radius: 18px; }
      .popup-left { left: 130px; }
      .popup-right { right: 130px; }
      /* While a number callout holds the upper band: a smaller card under the captions, above the Reels UI. */
      .popup-low { top: 1195px; width: 320px; height: 320px; border-width: 10px; }
      /* Map intro: covers the footage (bottom half on split screen). Above the caption scrim, which
         dimmed it in testing, but under the captions, callouts and pop-ups. The background is the
         ocean colour, so the world's edges don't show as a box while zoomed out. */
      #mapwrap { position: absolute; z-index: 910; left: 0; top: 0; width: 1080px; height: 1920px; opacity: 0; }
      #mapwrap.split-map { top: ${HALF_PX}px; height: ${HALF_PX}px; }
      #mapintro { position: absolute; inset: 0; overflow: hidden; background: #12263a; }
      #mapintro svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      #maplabel {
        position: absolute; left: 0; right: 0; display: flex; justify-content: center;
      }
      #maplabel span {
        background: var(--accent); color: #111; font-weight: 900; font-size: 46px; letter-spacing: 0.04em;
        text-transform: uppercase; padding: 8px 26px 10px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      }
      /* Student section label: a small pill in the gap between the callout band and the captions. */
      #sections { position: absolute; z-index: 1002; left: 140px; right: 140px; top: 756px; height: 60px; }
      .section {
        position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; opacity: 0;
      }
      .section span {
        background: rgba(0,0,0,0.72); color: var(--accent); font-weight: 900; font-size: 34px;
        letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 22px 8px; border-radius: 14px;
        border: 3px solid var(--accent);
      }
      /* Student section list, in the very top-left corner (asked for there; Instagram's own header
         can overlap this zone in the app). Above the map and the scrim. */
      #seclist { position: absolute; z-index: 940; left: 40px; top: 40px; width: 300px; height: 190px; }
      #seclist .inner { position: absolute; inset: 0; opacity: 0; }
      #seclist .row {
        display: flex; align-items: center; gap: 12px; height: 40px; color: rgba(255,255,255,0.45);
        font-weight: 800; font-size: 27px; letter-spacing: 0.02em; text-shadow: 0 2px 10px rgba(0,0,0,0.9);
      }
      #seclist .dot { width: 14px; height: 14px; border-radius: 50%; border: 3px solid currentColor; flex: none; }
      /* Source credit, just under Instagram's top UI zone. */
      #creditline { position: absolute; z-index: 1001; left: 140px; right: 140px; top: 250px; height: 60px; }
      .credit {
        text-align: center; color: rgba(255,255,255,0.9); font-weight: 700; font-size: 32px;
        letter-spacing: 0.02em; text-shadow: 0 2px 10px rgba(0,0,0,0.9);
      }
    </style>
  </head>
  <body>
    <div id="root"${split ? ' class="split"' : ""} data-composition-id="main" data-start="0" data-duration="${D}" data-width="1080" data-height="1920">
${shotHtml}
${bottomHtml}${split ? `\n      <div id="divider"></div>` : ""}
      <div id="scrim" class="clip" data-start="0" data-duration="${D}" data-track-index="4"></div>${mapHtml ? `\n${mapHtml}` : ""}${popupHtml ? `\n${popupHtml}` : ""}
      <div id="callouts" class="clip" data-start="0" data-duration="${D}" data-track-index="5"></div>
      <div id="captions" class="clip" data-start="0" data-duration="${D}" data-track-index="6"></div>
      <div id="titlecard" class="clip" data-start="0" data-duration="${D}" data-track-index="7"></div>
      <div id="creditline" class="clip" data-start="0" data-duration="${D}" data-track-index="8"></div>
      <div id="sections" class="clip" data-start="0" data-duration="${D}" data-track-index="9"></div>
      <div id="seclist" class="clip" data-start="0" data-duration="${D}" data-track-index="10"><div class="inner"></div></div>
${audio}
${musicHtml}${sfxHtml ? `\n${sfxHtml}` : ""}
    </div>
    <script>
      const DATA = ${inlineJson(data)};
      const FILM_END = ${D};
      const MAX_WORDS_PER_CHUNK = 3;
      const PAUSE_BREAK = 0.35; // a silence this long starts a new caption chunk
      const tl = gsap.timeline({ paused: true });

      // ---- Shots: motion + fades on the untimed wrappers ----
      // Motion states are computed in composition.ts so the loop shot can end on the opening state.
      DATA.shots.forEach((s, g) => {
        const w = "#w" + g;
        tl.fromTo(w, { ...s.from }, { ...s.to, duration: s.dur, ease: "none" }, s.start);
        if (s.fadeIn) tl.fromTo(w, { opacity: 0 }, { opacity: 1, duration: DATA.fade, ease: "power1.out" }, s.start);
      });
      DATA.bottom.forEach((s, g) => {
        const w = "#b" + g;
        tl.fromTo(w, { ...s.from }, { ...s.to, duration: s.dur, ease: "none" }, s.start);
        if (s.fadeIn) tl.fromTo(w, { opacity: 0 }, { opacity: 1, duration: DATA.fade, ease: "power1.out" }, s.start);
      });

      // ---- Hook title: on screen from the very first frame, back for the loop point ----
      if (DATA.title) {
        const title = document.createElement("div");
        title.className = "title";
        title.textContent = DATA.title;
        document.getElementById("titlecard").appendChild(title);
        tl.set(title, { opacity: 1 }, 0);
        tl.fromTo(title, { opacity: 1 }, { opacity: 0, duration: 0.25, ease: "power1.in", immediateRender: false }, DATA.titleOff);
        tl.fromTo(title, { opacity: 0 }, { opacity: 1, duration: ${TITLE_RETURN_S}, ease: "power1.out", immediateRender: false }, DATA.titleBack);
      }

      // ---- Source credit: small, on screen the whole time (an end card would break the loop) ----
      if (DATA.credit) {
        const credit = document.createElement("div");
        credit.className = "credit";
        credit.textContent = DATA.credit;
        document.getElementById("creditline").appendChild(credit);
      }

      // ---- Captions: 3-word chunks per segment, current word highlighted ----
      const chunks = [];
      DATA.words.forEach((words) => {
        const segChunks = [];
        words.forEach((w, i) => {
          const current = segChunks[segChunks.length - 1];
          const pause = i > 0 ? w.start - words[i - 1].end : 0;
          if (!current || current.length >= MAX_WORDS_PER_CHUNK || pause > PAUSE_BREAK) segChunks.push([w]);
          else current.push(w);
        });
        // Don't leave a lone word as a segment's last caption: fold it into the chunk before it.
        if (segChunks.length > 1 && segChunks[segChunks.length - 1].length === 1) {
          segChunks[segChunks.length - 2].push(...segChunks.pop());
        }
        chunks.push(...segChunks);
      });
      const captions = document.getElementById("captions");
      chunks.forEach((chunk, ci) => {
        const el = document.createElement("div");
        el.className = "chunk";
        captions.appendChild(el);
        // The last caption clears just after its last word, so the loop point shows no stale text.
        const end = ci + 1 < chunks.length ? chunks[ci + 1][0].start : Math.min(FILM_END, chunk[chunk.length - 1].end + 0.1);
        tl.set(el, { visibility: "visible" }, chunk[0].start);
        tl.set(el, { visibility: "hidden" }, end);
        chunk.forEach((w, wi) => {
          const span = document.createElement("span");
          span.className = "word";
          span.textContent = w.word;
          el.appendChild(span);
          // Whisper sometimes returns zero-length words: hold the highlight until the next word starts.
          const next = chunk[wi + 1];
          const off = Math.max(next ? next.start : w.end, w.start + 0.1);
          tl.fromTo(span, { scale: 0.9 }, { scale: 1, duration: 0.12, ease: "back.out(3)" }, w.start);
          tl.set(span, { color: "var(--accent)" }, w.start);
          tl.set(span, { color: "var(--ink)" }, off);
        });
      });

      // ---- Number callouts ----
      const callouts = document.getElementById("callouts");
      DATA.callouts.forEach((c) => {
        const el = document.createElement("div");
        el.className = "callout";
        const num = document.createElement("div");
        num.className = "num";
        num.textContent = c.main;
        el.appendChild(num);
        if (c.sub) {
          const sub = document.createElement("div");
          sub.className = "sub";
          sub.textContent = c.sub;
          el.appendChild(sub);
        }
        callouts.appendChild(el);
        tl.set(el, { visibility: "visible" }, c.start);
        tl.fromTo(num, { scale: 0.5, rotation: -4 }, { scale: 1, rotation: 0, duration: 0.35, ease: "back.out(2.2)" }, c.start);
        tl.set(el, { visibility: "hidden" }, c.end);
      });

      // ---- Student section labels: slide up and fade in, fade out (untimed children of a clip) ----
      const sections = document.getElementById("sections");
      DATA.sections.forEach((s) => {
        const el = document.createElement("div");
        el.className = "section";
        const pill = document.createElement("span");
        pill.textContent = s.text;
        el.appendChild(pill);
        sections.appendChild(el);
        tl.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, s.start);
        tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.25, ease: "power1.in", immediateRender: false }, s.end - 0.25);
      });

      // ---- Student section list: the current section lights up, finished ones dim ----
      if (DATA.sectionList) {
        const L = DATA.sectionList;
        const inner = document.querySelector("#seclist .inner");
        const rows = L.items.map((name) => {
          const row = document.createElement("div");
          row.className = "row";
          const dot = document.createElement("span");
          dot.className = "dot";
          row.appendChild(dot);
          row.appendChild(document.createTextNode(name));
          inner.appendChild(row);
          return { row, dot };
        });
        const UPCOMING = "rgba(255,255,255,0.45)", DONE = "rgba(255,255,255,0.75)", NOW = "#ffd60a";
        tl.fromTo(inner, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, L.show);
        L.marks.forEach((m, i) => {
          // Everything before this mark is done, this one is now, the rest upcoming.
          rows.forEach((r, k) => {
            const color = k === m.item ? NOW : L.marks.slice(0, i).some((p) => p.item === k) ? DONE : UPCOMING;
            tl.set(r.row, { color }, m.start);
            tl.set(r.dot, { backgroundColor: k === m.item ? NOW : L.marks.slice(0, i).some((p) => p.item === k) ? DONE : "transparent" }, m.start);
          });
          tl.fromTo(rows[m.item].row, { x: 0 }, { x: 10, duration: 0.2, ease: "power2.out", immediateRender: false }, m.start);
          if (i > 0) tl.to(rows[L.marks[i - 1].item].row, { x: 0, duration: 0.2 }, m.start);
        });
        tl.fromTo(inner, { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "power1.in", immediateRender: false }, L.hide - 0.3);
      }

      // ---- Pop-up photos: bounce in tilted, drift up a little, shrink away ----
      DATA.popups.forEach((p, i) => {
        const w = "#p" + i;
        const out = Math.max(p.start + 0.4, p.end - 0.22);
        tl.fromTo(w, { opacity: 0, scale: 0.3, rotation: p.tilt * 3 }, { opacity: 1, scale: 1, rotation: p.tilt, duration: 0.35, ease: "back.out(2)" }, p.start);
        tl.fromTo(w, { y: 0 }, { y: -16, duration: p.end - p.start, ease: "none" }, p.start);
        tl.fromTo(w, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.7, duration: p.end - out, ease: "power1.in", immediateRender: false }, out);
      });

      // ---- Map intro: zoom from the whole world into the study's country ----
      // The viewBox is recomputed from one progress value, so the map is redrawn as vectors at every
      // frame (no blurry scaled bitmap). Zoom is exponential so it feels steady, not rushed at the start.
      if (DATA.map) {
        const m = DATA.map;
        const svg = document.querySelector("#mapintro svg");
        const W = 1080, H = m.height;
        const label = document.getElementById("maplabel");
        const pill = document.createElement("span");
        pill.textContent = m.label;
        label.appendChild(pill);
        label.style.top = Math.max(20, m.focusY - 255) + "px"; // just above the country, below the captions
        const pin = document.getElementById("mappin");
        const ring = document.getElementById("mapring");
        // viewBox at zoom progress t (0 = whole world, 1 = the country at focusY).
        const viewBox = (t) => {
          const s = Math.pow(m.scale, t);
          const px = m.from.x + (m.to.x - m.from.x) * t, py = m.from.y + (m.to.y - m.from.y) * t;
          const sy = H / 2 + (m.focusY - H / 2) * t; // screen point the world point sits at
          return [px - 540 / s, py - sy / s, W / s, H / s].map((v) => v.toFixed(3)).join(" ");
        };
        // Precomputed keyframes (eased power2.inOut) tweened as a plain attribute: no onUpdate
        // callback, because GSAP skips callbacks when a renderer jumps straight to a frame (seek).
        const STEPS = 24;
        const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
        const zoomEnd = Math.max(m.start + 0.8, m.end - 0.7);
        const stepDur = (zoomEnd - m.start) / STEPS;
        tl.fromTo("#mapwrap", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, m.start);
        tl.set(svg, { attr: { viewBox: viewBox(0) } }, 0);
        for (let i = 1; i <= STEPS; i++) {
          tl.to(svg, { attr: { viewBox: viewBox(ease(i / STEPS)) }, duration: stepDur, ease: "none" }, m.start + (i - 1) * stepDur);
        }
        tl.fromTo([pin, ring], { opacity: 0 }, { opacity: 1, duration: 0.2 }, zoomEnd - 0.25);
        tl.fromTo(ring, { attr: { r: m.pin.r } }, { attr: { r: m.pin.r * 3.2 }, duration: 0.9, ease: "power1.out" }, zoomEnd - 0.25);
        tl.fromTo(pill, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3, ease: "back.out(2)" }, zoomEnd - 0.35);
        tl.fromTo("#mapwrap", { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "power1.in", immediateRender: false }, m.end - 0.3);
      }

      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

export const HYPERFRAMES_JSON = {
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
  media: { autoProxy: true },
};
