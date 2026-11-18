// Spike step 3: one sentence -> OpenAI TTS (tts-1) -> Whisper word timestamps.
// Run from the repo root:  node scripts/make-audio.ts
// Writes spike/assets/voice.mp3, spike/assets/words.json and spike/assets/words.js.
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

process.loadEnvFile(".env");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing from .env");

// Hand-written placeholder line for the spike (not taken from any article).
const SENTENCE =
  "Here is one idea from the article, turned into a ten second reel, with captions that follow every single word.";
const VOICE = "nova";
// The one-pager asks for "slightly faster than natural" pacing.
const SPEED = 1.1;

const ASSETS = join("spike", "assets");

type Word = { word: string; start: number; end: number };

async function tts(text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", voice: VOICE, input: text, speed: SPEED, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function transcribeWords(audio: Buffer): Promise<{ duration: number; words: Word[] }> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "voice.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  // Giving Whisper the known script nudges it to spell words the same way.
  form.append("prompt", SENTENCE);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { duration: json.duration, words: json.words };
}

await mkdir(ASSETS, { recursive: true });

console.log("Generating speech...");
const audio = await tts(SENTENCE);
await writeFile(join(ASSETS, "voice.mp3"), audio);

console.log("Transcribing with word timestamps...");
const { duration, words } = await transcribeWords(audio);
const data = { sentence: SENTENCE, duration, words };
await writeFile(join(ASSETS, "words.json"), JSON.stringify(data, null, 2));
// The composition can't fetch at render time, so it loads the words as a plain script.
await writeFile(join(ASSETS, "words.js"), `window.__CAPTIONS = ${JSON.stringify(data)};\n`);

console.log(`\nAudio duration: ${duration.toFixed(2)}s, ${words.length} words\n`);
console.log("  #  start   end    gap   word");
words.forEach((w, i) => {
  const gap = i === 0 ? w.start : w.start - words[i - 1].end;
  console.log(
    `${String(i + 1).padStart(3)}  ${w.start.toFixed(2).padStart(5)}  ${w.end.toFixed(2).padStart(5)}  ${gap.toFixed(2).padStart(5)}   ${w.word}`,
  );
});
