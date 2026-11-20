export type JobStatus =
  | "awaiting_upload"
  | "uploaded"
  | "extracting"
  | "extracted"
  | "proposing"
  | "awaiting_selection"
  | "points_selected"
  | "scripting"
  | "voicing"
  | "voiced"
  | "fetching_broll"
  | "rendering"
  | "rendered"
  | "failed";

// Statuses after which the job won't change again without user action.
export const SETTLED_STATUSES: JobStatus[] = ["awaiting_selection", "rendered", "failed"];

/** The media picked for one shot (older jobs: one photo per segment, without kind/shot). */
export type BrollImage = {
  segment: number;
  /** Shot index within its segment. */
  shot?: number;
  kind?: "image" | "video";
  query: string;
  /** Photos: our copy in the private "media" bucket. */
  imagePath?: string;
  /** Videos: Pixabay file URL, downloaded at render time (videos aren't stored, to save space). */
  videoUrl?: string;
  /** Seconds into the clip to start from. */
  mediaStart?: number;
  pixabayId: number;
  user: string;
  pageURL: string;
};

export type PointType = "stat" | "quote" | "claim";

export type CandidatePoint = {
  id: string;
  type: PointType;
  /** Short wording shown in the checklist and used for the video beat. */
  text: string;
  /** A sentence copied verbatim from the article that supports the point. */
  evidence: string;
  /** One of the (up to) 5 points pre-selected for the video. */
  recommended?: boolean;
};

/** One fact about where/when/who the study was, with the article sentence that states it. */
export type SettingFact = { value: string; evidence: string };

/** Where and when the study took place and who it covered, pulled from the whole article.
 *  A fact is missing when the article doesn't state it or its evidence couldn't be verified. */
export type StudySetting = { place?: SettingFact; period?: SettingFact; sample?: SettingFact };

export type Script = {
  hook: string;
  hookBroll: string;
  hookShots?: string[];
  beats: { pointId: string; text: string; broll: string; shots?: string[] }[];
  closing: string;
  closingBroll: string;
  closingShots?: string[];
  // Reel-structure fields (older scripts don't have them).
  /** Up to 7 words shown big on screen in the first seconds (and again at the loop point). */
  hookTitle?: string;
  /** The strongest point: its beat comes last, and the hook teases it (open loop). */
  payoffPointId?: string;
  /** "Surname & Surname, 2021", only kept if the names and year are in the article. */
  sourceCredit?: string;
  /** Text to paste when posting: 1-2 sentences, a share/comment prompt and hashtags. Not spoken. */
  postCaption?: string;
};

export type Word = { word: string; start: number; end: number };

export type Segment = {
  kind: "hook" | "beat" | "closing";
  pointId?: string;
  text: string;
  /** 2-4 word topic for this part; the fallback b-roll search. */
  broll: string;
  /** 1-3 word stock-footage searches, one per shot (older jobs don't have these). */
  shots?: string[];
  /** Path inside the private "media" bucket. */
  audioPath: string;
  duration: number;
  words: Word[];
};

// ---- Add-ons (optional extras the user picks on the points screen) ----
export const MUSIC_MOODS = ["calm", "upbeat", "dramatic"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];
export const SPLIT_STYLES = ["gameplay", "satisfying"] as const;
export type SplitStyle = (typeof SPLIT_STYLES)[number];
export type Addons = {
  music?: MusicMood;
  split?: SplitStyle;
  /** With split "gameplay": the library clip to use (path in the "library" bucket); omitted = pick one. */
  gameplayClip?: string;
};

/** One clip in the split screen's bottom half. */
export type BottomClip = {
  source: "library" | "pixabay";
  /** Library clips: path in the private "library" bucket. */
  path?: string;
  /** Pixabay clips: file URL (downloaded at render time) and credit. */
  videoUrl?: string;
  /** Pixabay clips: length in seconds and seconds to skip at the start. */
  duration?: number;
  mediaStart?: number;
  query?: string;
  pixabayId?: number;
  user?: string;
  pageURL?: string;
};

/** What was picked for the add-ons, saved before rendering. */
export type AddonMedia = {
  music?: { path: string; title: string; artist?: string };
  bottom?: BottomClip[];
};

/** What the library has, for the add-on choices on the points screen. */
export type GameplayClip = {
  path: string;
  /** Readable name from the file name ("minecraft-parkour-1min.mp4" -> "minecraft parkour 1min"). */
  name: string;
  /** Short-lived signed link for a preview on the points screen. */
  previewUrl?: string;
};
export type LibraryInfo = { music: Record<MusicMood, number>; gameplay: number; gameplayClips: GameplayClip[] };

export type Job = {
  id: string;
  status: JobStatus;
  original_filename: string;
  file_path: string;
  page_count: number | null;
  word_count: number | null;
  extracted_text: string | null;
  candidate_points: CandidatePoint[] | null;
  study_setting?: StudySetting | null;
  selected_point_ids: string[] | null;
  selected_at: string | null;
  script: Script | null;
  segments: Segment[] | null;
  total_duration_s: number | null;
  broll: BrollImage[] | null;
  render_progress: number | null;
  video_path: string | null;
  /** Missing on rows from before migration 0005. */
  addons?: Addons | null;
  addon_media?: AddonMedia | null;
  /** When each status was first entered (migration 0006); missing on older rows. */
  stage_times?: Partial<Record<JobStatus | "created", string>> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_SELECTED_POINTS = 5;
