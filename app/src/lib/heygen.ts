import "server-only";
// HyperFrames Cloud rendering (HeyGen): zip the same project folder the local render uses, upload
// it, start a render and poll it. Docs: https://developers.heygen.com/hyperframes.md
// Price (platform.heygen.com/models/hyperframes, checked 2026-11-21): 1080p / 30 fps $0.15 per
// minute of output video.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import type { RenderTarget } from "@/lib/jobs";

const API = "https://api.heygen.com";

/** True when HeyGen Cloud can be used: an API key is set. */
export function cloudRenderAvailable(): boolean {
  return !!process.env.HEYGEN_API_KEY;
}

/** RENDER_MODE=cloud in .env makes the cloud the pre-selected choice (if a key is set); else local. */
export function defaultRenderTarget(): RenderTarget {
  return process.env.RENDER_MODE === "cloud" && cloudRenderAvailable() ? "cloud" : "local";
}

function key(): string {
  const k = process.env.HEYGEN_API_KEY;
  if (!k) throw new Error("HEYGEN_API_KEY is not set.");
  return k;
}

/** One HeyGen API call; returns `data`, or throws with HeyGen's own error code and message. */
async function call<T>(method: "GET" | "POST", url: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      "x-api-key": key(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: { data?: T; error?: { code?: string; message?: string } } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON error page
  }
  if (!res.ok || json.data === undefined) {
    const e = json.error;
    throw new Error(`HeyGen ${method} ${url} failed (${res.status}${e?.code ? `, ${e.code}` : ""}): ${e?.message ?? text.slice(0, 200)}`);
  }
  return json.data;
}

/** Files already compressed (video, audio, images) are stored as-is; text is deflated. */
const STORED = /\.(mp4|webm|mov|mp3|m4a|aac|jpe?g|png|webp|gif)$/i;
/** Local-only files the cloud doesn't need: the CLI runner, its log, and the local output. */
const SKIP = /^(run\.mjs|render\.log|render\.exit|out\/)/;

/** Zip a project folder (index.html at the root), leaving out the local render's own files. */
export async function zipProject(dir: string): Promise<Buffer> {
  const files: Zippable = {};
  const walk = async (sub: string) => {
    for (const entry of await readdir(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (SKIP.test(rel)) continue;
      if (entry.isDirectory()) await walk(rel);
      else files[rel] = [new Uint8Array(await readFile(path.join(dir, rel))), { level: STORED.test(rel) ? 0 : 6 }];
    }
  };
  await walk("");
  if (!files["index.html"]) throw new Error("The project has no index.html to render.");
  return Buffer.from(zipSync(files));
}

/** Upload a zip with HeyGen's direct upload (create -> PUT -> complete); returns its asset_id. */
export async function uploadZip(zip: Buffer, filename: string, idempotencyKey: string): Promise<string> {
  const created = await call<{ asset_id: string; upload_url: string; upload_headers?: Record<string, string>; max_bytes?: number }>(
    "POST",
    "/v3/assets/direct-uploads",
    { filename, content_type: "application/zip", size_bytes: zip.length },
    idempotencyKey,
  );
  if (created.max_bytes && zip.length > created.max_bytes) {
    throw new Error(`The project zip is ${zip.length} bytes, over HeyGen's ${created.max_bytes}-byte limit.`);
  }
  // The PUT goes straight to storage: only the signed headers, never the API key.
  const put = await fetch(created.upload_url, { method: "PUT", headers: created.upload_headers ?? {}, body: new Uint8Array(zip) });
  if (!put.ok) throw new Error(`Uploading the project zip failed (${put.status}): ${(await put.text()).slice(0, 200)}`);
  await call("POST", `/v3/assets/${created.asset_id}/complete`, {});
  return created.asset_id;
}

/** Start a 1080p, 9:16, 30 fps MP4 render. The idempotency key stops a retry from rendering (and billing) twice. */
export async function startCloudRender(assetId: string, title: string, idempotencyKey: string): Promise<string> {
  const quality = ["draft", "standard", "high"].includes(process.env.CLOUD_RENDER_QUALITY ?? "") ? process.env.CLOUD_RENDER_QUALITY : "standard";
  const data = await call<{ render_id: string }>(
    "POST",
    "/v3/hyperframes/renders",
    {
      project: { type: "asset_id", asset_id: assetId },
      fps: 30,
      quality,
      format: "mp4",
      resolution: "1080p",
      aspect_ratio: "9:16",
      title: title.slice(0, 500),
    },
    idempotencyKey,
  );
  return data.render_id;
}

export type CloudRender = {
  status: "queued" | "rendering" | "completed" | "failed";
  video_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  failure_code?: string | null;
  failure_message?: string | null;
  failure_detail?: string | null;
};

export async function getCloudRender(renderId: string): Promise<CloudRender> {
  return call<CloudRender>("GET", `/v3/hyperframes/renders/${renderId}`);
}
