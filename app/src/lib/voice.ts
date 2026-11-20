// Phase 3: text -> speech (OpenAI tts-1) -> word timestamps (Whisper). Ported from scripts/make-audio.ts.
import { openaiKey } from "./openai";
import type { Word } from "./jobs";

// The one-pager asks for "slightly faster than natural" pacing; 1.1 sounded right in the spike.
const SPEED = 1.1;

export async function textToSpeech(text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "tts-1",
      voice: process.env.OPENAI_TTS_VOICE || "nova",
      input: text,
      speed: SPEED,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function transcribeWords(audio: Buffer, script: string): Promise<{ duration: number; words: Word[] }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "segment.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  // Passing the known script nudges Whisper to spell words (and numbers) the same way.
  form.append("prompt", script);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { duration: json.duration, words: json.words ?? [] };
}
