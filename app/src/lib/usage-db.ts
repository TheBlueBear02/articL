import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sumTokens, type TokenUsage, type UsagePart } from "@/lib/pricing";
import type { Usage } from "@/lib/openai";

/** One chat call's usage, as the pricing helpers count it. */
export function tokensOf(model: string, u: Usage): TokenUsage {
  return { model, calls: 1, input: u.input_tokens, cachedInput: u.cached_tokens ?? 0, output: u.output_tokens, reasoning: u.reasoning_tokens };
}

/**
 * Record one part of a job's usage ("script:2", "voice:1:3"). Never fails the job: before
 * migration 0009 there's no column or function, and usage is only shown, never needed.
 */
export async function saveUsage(jobId: string, part: string, value: UsagePart | null): Promise<void> {
  if (!value) return;
  const { error } = await supabaseAdmin().rpc("add_job_usage", { job_id: jobId, part, value });
  if (error) console.warn(`[usage] not recorded (${part}): ${error.message}`);
}

/** Save several chat calls as one part. */
export async function saveTokens(jobId: string, part: string, calls: TokenUsage[]): Promise<void> {
  await saveUsage(jobId, part, sumTokens(calls));
}
