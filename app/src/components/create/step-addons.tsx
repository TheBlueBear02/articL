"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  audienceOf,
  MUSIC_MOODS,
  resolveAddons,
  type Addons,
  type AuthorInfo,
  type GameplayClip,
  type Job,
  type LibraryInfo,
  type MusicMood,
  type SplitStyle,
} from "@/lib/jobs";
import { ActionBar, Button, Card, Check, ErrorNote, Fold, Segmented, StepHeading, TextField, Toggle, cx } from "./ui";
import { post } from "./use-job";

const MOOD_LABEL: Record<MusicMood, string> = { calm: "Calm", upbeat: "Upbeat", dramatic: "Dramatic" };

/** What the background is doing while the user picks add-ons. */
export function scriptProgress(job: Job): string {
  if (job.status === "points_selected" || job.status === "scripting") return "Writing your script and checking every number…";
  if (job.status === "voicing") return "Recording the voiceover…";
  if (job.status === "voiced") return "Checking for overclaims…";
  return "Your script is ready";
}

/** Step 5: music, split screen (Social only), more options, and who did the research. */
export function StepAddons({ job, onDone }: { job: Job; onDone: () => void }) {
  const social = audienceOf(job) === "social";
  const [addons, setAddons] = useState<Addons>(() => resolveAddons(job.addons, audienceOf(job)));
  const [author, setAuthor] = useState<AuthorInfo>(job.author_info ?? {});
  const [lib, setLib] = useState<LibraryInfo | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => !d.error && setLib(d as LibraryInfo))
      .catch(() => {});
  }, []);

  const set = (patch: Partial<Addons>) => setAddons((a) => ({ ...a, ...patch }));
  const moodsWithMusic = MUSIC_MOODS.filter((m) => (lib?.music[m] ?? 0) > 0);
  const hasMusic = moodsWithMusic.length > 0;
  const hasGameplay = (lib?.gameplay ?? 0) > 0;

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const clean: Addons = { ...addons, ...(social ? {} : { split: undefined, gameplayClip: undefined }) };
      if (clean.split !== "gameplay") delete clean.gameplayClip;
      await post(job.id, "setup", { addons: clean, author, confirm: true });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }


  return (
    <>
      <StepHeading eyebrow="Step 5 · Add-ons" title="Make it yours" />

      <div className="space-y-3">
        <Card index={0} className="p-5">
          <Row title="Music" hint={hasMusic || !lib ? "Plays softly under the voice" : "No tracks in the library yet"}>
            <Toggle
              label="Music"
              on={!!addons.music}
              disabled={!hasMusic}
              onChange={(on) => set({ music: on ? (moodsWithMusic[0] ?? "calm") : undefined })}
            />
          </Row>
          <Fold open={!!addons.music}>
            <div className="pt-4">
              <Segmented
                value={addons.music}
                onChange={(music) => set({ music })}
                options={MUSIC_MOODS.map((m) => ({ value: m, label: MOOD_LABEL[m], disabled: !(lib?.music[m] ?? 0) }))}
              />
            </div>
          </Fold>
        </Card>

        {social && (
          <Card index={1} className="p-5">
            <Row title="Split screen" hint="Gameplay or satisfying clips under the story">
              <Toggle label="Split screen" on={!!addons.split} onChange={(on) => set({ split: on ? (hasGameplay ? "gameplay" : "satisfying") : undefined })} />
            </Row>
            <Fold open={!!addons.split}>
              <div className="pt-4">
                <Segmented<SplitStyle>
                  value={addons.split}
                  onChange={(split) => set({ split, gameplayClip: split === "gameplay" ? addons.gameplayClip : undefined })}
                  options={[
                    { value: "gameplay", label: "Gameplay", disabled: !hasGameplay },
                    { value: "satisfying", label: "Satisfying" },
                  ]}
                />
              </div>
              <Fold open={addons.split === "gameplay" && !!lib?.gameplayClips.length}>
                <GameplayPicker clips={lib?.gameplayClips ?? []} value={addons.gameplayClip} onChange={(gameplayClip) => set({ gameplayClip })} />
              </Fold>
            </Fold>
          </Card>
        )}

        <Card index={2} className="p-5">
          <button type="button" onClick={() => setMore((m) => !m)} className="flex w-full items-center justify-between text-left" aria-expanded={more}>
            <span>
              <span className="block text-[15px] font-semibold text-neutral-950">More options</span>
              <span className="mt-0.5 block text-[13px] text-neutral-500">Pop-ups, sounds, map, charts and paper page are on</span>
            </span>
            <svg className={`transition-transform duration-300 ${more ? "rotate-180" : ""}`} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 9l6 6 6-6" stroke="#737373" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <Fold open={more}>
            <div className="space-y-4 pt-5">
              <Row title="Pop-up images" hint="A small photo when a thing is named">
                <Toggle label="Pop-up images" on={addons.popups !== false} onChange={(popups) => set({ popups })} />
              </Row>
              <Row title="Sound effects" hint="Pop, ding and whoosh, under the voice">
                <Toggle label="Sound effects" on={addons.sfx !== false} onChange={(sfx) => set({ sfx })} />
              </Row>
              <Row title="Map intro" hint="Zooms into the study's country">
                <Toggle label="Map intro" on={addons.map !== false} onChange={(map) => set({ map })} />
              </Row>
              <Row title="Data visuals" hint="Animated charts for compared numbers">
                <Toggle label="Data visuals" on={addons.charts !== false} onChange={(charts) => set({ charts })} />
              </Row>
              <Row title="Paper page" hint="Your paper's first page when the study is mentioned">
                <Toggle label="Paper page" on={addons.paperPage !== false} onChange={(paperPage) => set({ paperPage })} />
              </Row>
              {lib?.render && (
                <div>
                  <p className="mb-2 text-[13px] font-medium text-neutral-700">Render on</p>
                  <Segmented
                    value={addons.render ?? lib.render.default}
                    onChange={(render) => set({ render })}
                    options={[
                      { value: "local", label: "This computer" },
                      { value: "cloud", label: "HeyGen Cloud", disabled: !lib.render.cloud },
                    ]}
                  />
                </div>
              )}
            </div>
          </Fold>
        </Card>

        <Card index={3} className="space-y-3 p-5">
          <div>
            <p className="text-[15px] font-semibold text-neutral-950">For the caption</p>
            <p className="mt-0.5 text-[13px] text-neutral-500">Added to the post text. All optional.</p>
          </div>
          <TextField label="Author's name" maxLength={120} value={author.name ?? ""} onChange={(name) => setAuthor((a) => ({ ...a, name }))} />
          <TextField label="Role" placeholder="e.g. PhD student" maxLength={120} value={author.role ?? ""} onChange={(role) => setAuthor((a) => ({ ...a, role }))} />
          <TextField label="University" maxLength={120} value={author.university ?? ""} onChange={(university) => setAuthor((a) => ({ ...a, university }))} />
        </Card>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <ActionBar>
        <Button busy={busy} onClick={next}>
          Continue to script
        </Button>
      </ActionBar>
    </>
  );
}

/**
 * Which gameplay clip plays in the bottom half: swipe through the library's clips and tap one, or
 * leave "Surprise me" (a different clip per video). The chosen clip plays its preview, muted.
 */
function GameplayPicker({ clips, value, onChange }: { clips: GameplayClip[]; value?: string; onChange: (path?: string) => void }) {
  const tile = (on: boolean) =>
    cx(
      "relative aspect-video w-[46%] shrink-0 snap-start overflow-hidden rounded-xl transition duration-200 active:scale-[0.98]",
      on ? "shadow-[0_0_0_2.5px_var(--a2r-brand)]" : "shadow-[0_0_0_1px_#e5e5e5]",
    );
  return (
    <div className="pt-4">
      <p className="mb-2 text-[13px] font-medium text-neutral-700">Pick the gameplay</p>
      <div className="a2r-noscrollbar -mx-5 flex snap-x gap-2.5 overflow-x-auto scroll-px-5 px-5 py-1">
        <button type="button" onClick={() => onChange(undefined)} aria-pressed={!value} className={tile(!value)}>
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[var(--a2r-soft)] text-[12px] font-semibold text-neutral-800">
            <span className="text-[18px] leading-none">✦</span>
            Surprise me
          </span>
        </button>
        {clips.map((c) => {
          const on = value === c.path;
          return (
            <button key={c.path} type="button" onClick={() => onChange(c.path)} aria-pressed={on} aria-label={c.name} className={tile(on)}>
              {c.previewUrl ? (
                <video
                  // "#t=3" shows a frame from the action, not a black first frame.
                  src={`${c.previewUrl}#t=3`}
                  muted
                  loop
                  playsInline
                  autoPlay={on}
                  preload="metadata"
                  ref={(el) => {
                    if (!el) return;
                    if (on) el.play().catch(() => {});
                    else el.pause();
                  }}
                  className="h-full w-full bg-black object-cover"
                />
              ) : (
                <span className="block h-full w-full bg-neutral-200" />
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-2 pt-4 pb-1.5 text-left text-[11px] font-semibold text-white">
                {c.name}
              </span>
              {on && (
                <span className="absolute top-1.5 right-1.5">
                  <Check />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-neutral-950">{title}</p>
        <p className="mt-0.5 text-[13px] text-neutral-500">{hint}</p>
      </div>
      {children}
    </div>
  );
}
