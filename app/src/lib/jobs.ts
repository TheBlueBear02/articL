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
// (awaiting_selection is no longer a pause — points are auto-chosen — but old rows may still have it.)
export const SETTLED_STATUSES: JobStatus[] = ["rendered", "failed"];

/** Short labels for the job page and My videos list. */
export const STATUS_LABEL: Record<JobStatus, string> = {
  awaiting_upload: "Uploading…",
  uploaded: "Uploaded, waiting to start…",
  extracting: "Extracting text…",
  extracted: "Text extracted",
  proposing: "Finding key points…",
  awaiting_selection: "Choosing points…",
  points_selected: "Points saved",
  scripting: "Writing the script…",
  voicing: "Recording the voiceover…",
  voiced: "Voiceover ready",
  fetching_broll: "Finding visual materials…",
  rendering: "Rendering the video…",
  rendered: "Video ready",
  failed: "Failed",
};

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

/** stat / quote / claim are findings; question and method (Student videos) are the research
 *  question and how it was tested. */
export type PointType = "stat" | "quote" | "claim" | "question" | "method";

// ---- Who the video is for (migration 0008) ----
export const AUDIENCES = ["social", "student", "academic", "kids"] as const;
export type Audience = (typeof AUDIENCES)[number];
/** Audiences that can be chosen today; the others show as "coming soon". */
export const READY_AUDIENCES: Audience[] = ["social", "student"];
export const AUDIENCE_LABEL: Record<Audience, string> = {
  social: "Social",
  student: "Student",
  academic: "Academic",
  kids: "Kids",
};
export const AUDIENCE_HINT: Record<Audience, string> = {
  social: "Hooky, fast reel of the main findings (up to 60 s)",
  student: "The question, how it was tested and what was found (60-90 s)",
  academic: "Design, methods and results in depth (coming soon)",
  kids: "One big idea, cartoon style (coming soon)",
};
/** Older jobs and databases before migration 0008 are Social. */
export const audienceOf = (job: { audience?: string | null }): Audience =>
  (AUDIENCES as readonly string[]).includes(job.audience ?? "") ? (job.audience as Audience) : "social";

export type CandidatePoint = {
  id: string;
  type: PointType;
  /** Short wording shown in the checklist and used for the video beat. */
  text: string;
  /** A sentence copied verbatim from the article that supports the point. */
  evidence: string;
  /** One of the (up to) 5 points pre-selected for the video. */
  recommended?: boolean;
  /** Student videos: the study's main result (the answer to its question). */
  main?: boolean;
};

/** One fact about where/when/who the study was, with the article sentence that states it. */
export type SettingFact = { value: string; evidence: string };

/** Where and when the study took place and who it covered, pulled from the whole article.
 *  A fact is missing when the article doesn't state it or its evidence couldn't be verified. */
export type StudySetting = { place?: SettingFact; period?: SettingFact; sample?: SettingFact };

/** A picturable word in a beat, shown as a small pop-up photo when it is spoken. */
export type Popup = {
  /** Copied from the beat's spoken text, 1-3 words ("ballot box"). */
  word: string;
  /** 1-3 word Pixabay photo search for it. */
  query: string;
};

export type Script = {
  hook: string;
  hookBroll: string;
  hookShots?: string[];
  beats: { pointId: string; text: string; broll: string; shots?: string[]; popup?: Popup }[];
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
  /** Beats only: the word to show a pop-up photo for (older jobs don't have it). */
  popup?: Popup;
  /** Student videos: the on-screen section label ("THE QUESTION"). */
  section?: string;
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
  /** Small photos that pop up when a picturable word is spoken (on by default). */
  popups?: boolean;
  /** Pop / ding / whoosh sounds on pop-ups, number callouts and new beats (on by default). */
  sfx?: boolean;
  /** A map zooming into the study's country in the first beat (on by default; needs a known country). */
  map?: boolean;
};

/** Pop-ups, sound effects and map start on; music and split stay off until chosen. */
export const DEFAULT_ADDONS: Addons = { popups: true, sfx: true, map: true };

/** Fill in default on/off flags when a job has no saved add-ons (or only music/split). */
export function resolveAddons(raw?: Addons | null): Addons {
  return { ...DEFAULT_ADDONS, ...(raw ?? {}) };
}

/** The map intro picked for a job: the country and when it shows. */
export type MapMedia = {
  /** Natural Earth country name (finds the shape). */
  country: string;
  /** As the article writes it ("England"), shown on the map. */
  label: string;
  /** "2007–2011", or "" when the period is unknown. */
  period: string;
  start: number;
  end: number;
};

/** A pop-up photo picked for a beat, with its time on the film and its Pixabay credit. */
export type PopupMedia = {
  segment: number;
  word: string;
  query: string;
  start: number;
  end: number;
  /** Which side of the screen it leans to; alternates so consecutive pop-ups don't look the same. */
  side: "left" | "right";
  /** "high" above the captions, or "low" below them while a number callout holds the upper band. */
  place?: "high" | "low";
  /** Path inside the private "media" bucket. */
  imagePath: string;
  pixabayId: number;
  user: string;
  pageURL: string;
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
  popups?: PopupMedia[];
  map?: MapMedia;
  /** Pop-up photos chosen while the voice was recorded; the footage step times and uses them. */
  preparedPopups?: PreparedPopup[];
};

/** A beat's pop-up photo, picked before the recording's timing is known. */
export type PreparedPopup = {
  segment: number;
  word: string;
  query: string;
  photo: { id: number; largeImageURL: string; user: string; pageURL: string; webformatURL?: string };
};

/** What the library has, for the add-on choices while the article is prepared. */
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
  /** OpenAI usage per step (migration 0009): see lib/pricing.ts. */
  usage?: import("./pricing").JobUsage | null;
  /** Who the video is for (migration 0008); missing means "social". */
  audience?: Audience | null;
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
