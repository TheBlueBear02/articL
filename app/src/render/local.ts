import "server-only";
// Phase 4: render a composition on this machine with the HyperFrames CLI (local-first, per the
// one-pager). A render takes minutes, so it runs as a detached process that writes its progress
// to render.log and its exit code to render.exit; the Inngest job polls those files.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const HYPERFRAMES = "hyperframes@0.9.67"; // same pinned version as the spike

export function projectDir(jobId: string): string {
  return path.join(tmpdir(), "articl-render", jobId);
}

export const VIDEO_FILE = "out/video.mp4";

/**
 * HyperFrames render quality: draft | looks | delivery (CLI default: looks). Draft while
 * prototyping, for speed; set RENDER_QUALITY=looks (or delivery) in .env for final output.
 */
function renderQuality(): string {
  const q = process.env.RENDER_QUALITY ?? "draft";
  return ["draft", "looks", "delivery", "standard", "high"].includes(q) ? q : "draft";
}

/** Write a fresh project folder: index.html, hyperframes.json and assets/. */
export async function writeProject(
  jobId: string,
  files: { path: string; content: string | Buffer }[],
): Promise<string> {
  const dir = projectDir(jobId);
  await rm(dir, { recursive: true, force: true });
  for (const f of files) {
    const full = path.join(dir, f.path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, f.content);
  }
  return dir;
}

// Runs inside the project folder: lint first (fails fast on a broken composition), then render.
const RUNNER = `import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
const log = createWriteStream("render.log");
function run(args) {
  return new Promise((resolve) => {
    const p = spawn("npx", ["-y", "${HYPERFRAMES}", ...args], { shell: true });
    p.stdout.pipe(log, { end: false });
    p.stderr.pipe(log, { end: false });
    p.on("close", (code) => resolve(code ?? 1));
  });
}
const lint = await run(["lint"]);
// --sdr: some Pixabay clips are HDR (HLG / BT.2020). One HDR clip makes HyperFrames render the whole
// reel as HDR HEVC through a slow single-worker layered path (testing: ~0.6 frames/s, ~40 min for a
// 48 s reel) and many browsers and phones can't play the result. Force normal (SDR) output instead.
const code = lint === 0 ? await run(["render", "--quality", "${renderQuality()}", "--sdr", "-o", "${VIDEO_FILE}"]) : lint;
writeFileSync("render.exit", String(code));
`;

export async function startRender(dir: string): Promise<void> {
  await writeFile(path.join(dir, "run.mjs"), RUNNER);
  const child = spawn(process.execPath, ["run.mjs"], {
    cwd: dir,
    detached: true,
    stdio: "ignore",
    env: process.env,
    windowsHide: true,
  });
  child.unref();
}

/** Length of an audio or video file in seconds, via ffprobe (installed with FFmpeg for rendering). */
export async function probeDuration(content: Buffer, ext: string): Promise<number> {
  const tmp = path.join(tmpdir(), `articl-probe-${process.pid}-${Date.now()}.${ext}`);
  await writeFile(tmp, content);
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", tmp], {
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`ffprobe failed: ${stderr.trim()}`))));
    });
    const seconds = Number.parseFloat(out.trim());
    if (!Number.isFinite(seconds)) throw new Error(`ffprobe gave no duration (${out.trim() || "empty"}).`);
    return seconds;
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * A small JPEG thumbnail of a finished video: the frame at 1 s (the hook title over the opening
 * shot), 360x640, ~20-40 KB, for the home page carousel. Uses FFmpeg, which local renders need anyway.
 */
export async function extractThumbnail(videoPath: string, atSeconds = 1): Promise<Buffer> {
  return extractFrame(videoPath, atSeconds);
}

/**
 * One 360x640 JPEG frame from a video (at `atSeconds`) or a photo (atSeconds null), cropped to 9:16.
 * Used for the carousel card, the cover the user picks and the build tracker's thumbnails.
 */
export async function extractFrame(input: string, atSeconds: number | null): Promise<Buffer> {
  const out = path.join(tmpdir(), `articl-thumb-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  const seek = atSeconds == null ? [] : ["-ss", String(Math.max(0, atSeconds))];
  try {
    await new Promise<void>((resolve, reject) => {
      const vf = "scale=360:640:force_original_aspect_ratio=increase,crop=360:640";
      const p = spawn("ffmpeg", ["-loglevel", "error", "-y", ...seek, "-i", input, "-frames:v", "1", "-vf", vf, "-q:v", "5", out], {
        windowsHide: true,
      });
      let stderr = "";
      p.stderr.on("data", (d) => (stderr += d));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg thumbnail failed: ${stderr.trim()}`))));
    });
    return await readFile(out);
  } finally {
    await rm(out, { force: true });
  }
}

export type RenderStatus ={ done: boolean; exitCode: number | null; progress: number; logTail: string };

/** Read progress from HyperFrames' "@hf-progress {...pct...}" lines and the exit file. */
export async function readRenderStatus(dir: string): Promise<RenderStatus> {
  const log = existsSync(path.join(dir, "render.log")) ? await readFile(path.join(dir, "render.log"), "utf8") : "";
  const pcts = [...log.matchAll(/@hf-progress (\{.*\})/g)]
    .map((m) => {
      try {
        return Number(JSON.parse(m[1]).pct);
      } catch {
        return NaN;
      }
    })
    .filter((n) => Number.isFinite(n));
  const exitPath = path.join(dir, "render.exit");
  const exitCode = existsSync(exitPath) ? Number(await readFile(exitPath, "utf8")) : null;
  const logTail = log
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("@hf-progress"))
    .slice(-12)
    .join("\n");
  return { done: exitCode !== null, exitCode, progress: pcts.length ? Math.max(...pcts) : 0, logTail };
}
