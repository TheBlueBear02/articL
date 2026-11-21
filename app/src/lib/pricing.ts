// Usage per step and its estimated cost. Pure (type-only imports), so it can be tested with plain node.

/**
 * OpenAI standard-tier prices in US dollars, from https://developers.openai.com/api/docs/pricing,
 * checked 2026-11-21. Estimates: OpenAI's own usage page is the bill.
 */
export const PRICES = {
  /** Per 1M tokens. Reasoning tokens are billed as output (they're included in the output count). */
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  /** tts-1: per 1M characters of text read aloud. */
  ttsPerMillionChars: 15.0,
  /** Whisper transcription: per minute of audio. */
  whisperPerMinute: 0.006,
  /** HyperFrames Cloud (HeyGen), 1080p / 30 fps: per minute of output video
   *  (platform.heygen.com/models/hyperframes, checked 2026-11-21). Billed by the second: a 50.4 s test
   *  render on 2026-11-21 cost $0.13 (= 50.4 / 60 x $0.15). */
  cloudRenderPerMinute: 0.15,
} as const;

/** One or more chat calls (points, script drafts, photo checks). */
export type TokenUsage = {
  model: string;
  calls: number;
  input: number;
  /** Part of `input` served from OpenAI's prompt cache (cheaper). */
  cachedInput: number;
  output: number;
  /** Part of `output` spent on reasoning. */
  reasoning: number;
};

/** One recorded voice part: text-to-speech + word timing. */
export type VoiceUsage = { ttsChars: number; whisperSeconds: number };

/** A cloud render: seconds of output video. Local renders cost nothing and aren't recorded. */
export type RenderUsage = { renderSeconds: number };

export type UsagePart = TokenUsage | VoiceUsage | RenderUsage;
/** jobs.usage (migration 0009): parts keyed "<step>:<part>", e.g. "script:2" or "voice:1:3". */
export type JobUsage = Record<string, UsagePart>;

const isTokens = (u: UsagePart): u is TokenUsage => "input" in u;
const isVoice = (u: UsagePart): u is VoiceUsage => "ttsChars" in u;
const isRender = (u: UsagePart): u is RenderUsage => "renderSeconds" in u;

/** Add up chat calls; the model is the last one's (all steps use OPENAI_MODEL). */
export function sumTokens(list: TokenUsage[]): TokenUsage | null {
  if (!list.length) return null;
  return list.reduce((a, b) => ({
    model: b.model || a.model,
    calls: a.calls + b.calls,
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  }));
}

/** Price for a model name like "gpt-5-mini-2025-08-07"; null for a model without a known price. */
function chatPrice(model: string) {
  const key = (Object.keys(PRICES) as (keyof typeof PRICES)[]).find((k) => typeof PRICES[k] === "object" && model.startsWith(k));
  return key ? (PRICES[key] as { input: number; cachedInput: number; output: number }) : null;
}

export function tokenCost(u: TokenUsage): number | null {
  const p = chatPrice(u.model);
  if (!p) return null;
  return ((u.input - u.cachedInput) * p.input + u.cachedInput * p.cachedInput + u.output * p.output) / 1e6;
}

export function voiceCost(u: VoiceUsage): number {
  return (u.ttsChars * PRICES.ttsPerMillionChars) / 1e6 + (u.whisperSeconds / 60) * PRICES.whisperPerMinute;
}

/** What one timing-panel step used: tokens, voice, or both (and the estimated cost). */
export type StepUsage = { tokens: TokenUsage | null; voice: VoiceUsage | null; render?: RenderUsage | null; cost: number | null };

export function renderCost(u: RenderUsage): number {
  return (u.renderSeconds / 60) * PRICES.cloudRenderPerMinute;
}

/** Group a job's usage parts by step ("points", "script", "voice", "footage"). */
export function usageByStep(usage: JobUsage | null | undefined): Record<string, StepUsage> {
  const groups: Record<string, UsagePart[]> = {};
  for (const [key, part] of Object.entries(usage ?? {})) (groups[key.split(":")[0]] ??= []).push(part);
  const out: Record<string, StepUsage> = {};
  for (const [step, parts] of Object.entries(groups)) {
    const tokens = sumTokens(parts.filter(isTokens));
    const voices = parts.filter(isVoice);
    const renders = parts.filter(isRender);
    const render = renders.length ? { renderSeconds: renders.reduce((a, b) => a + b.renderSeconds, 0) } : null;
    const voice = voices.length
      ? voices.reduce((a, b) => ({ ttsChars: a.ttsChars + b.ttsChars, whisperSeconds: a.whisperSeconds + b.whisperSeconds }))
      : null;
    const tc = tokens ? tokenCost(tokens) : 0;
    out[step] = { tokens, voice, render, cost: tc === null ? null : tc + (voice ? voiceCost(voice) : 0) + (render ? renderCost(render) : 0) };
  }
  return out;
}

/** "24.1k in · 6.2k out" / "1,050 chars · 52 s audio". */
export function formatUsage(s: StepUsage): string {
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const bits: string[] = [];
  if (s.tokens) bits.push(`${k(s.tokens.input)} in · ${k(s.tokens.output)} out${s.tokens.calls > 1 ? ` · ${s.tokens.calls} calls` : ""}`);
  if (s.voice) bits.push(`${s.voice.ttsChars.toLocaleString("en-US")} chars · ${Math.round(s.voice.whisperSeconds)} s audio`);
  if (s.render) bits.push(`${Math.round(s.render.renderSeconds)} s rendered in the cloud`);
  return bits.join(" · ");
}

/** "$0.018"; costs under a tenth of a cent show as "<$0.001". */
export function formatCost(cost: number | null): string {
  if (cost === null) return "";
  return cost < 0.001 ? "<$0.001" : `$${cost.toFixed(3)}`;
}
