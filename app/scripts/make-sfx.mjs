// Generate ArticL's built-in sound effects with FFmpeg (no licences to track).
// Run from app/:  node scripts/make-sfx.mjs
// Writes assets/sfx/{pop,ding,whoosh}.mp3. Uploading files with the same names to the Supabase
// "library" bucket (sfx/ folder) replaces them at render time.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const OUT = "assets/sfx";
mkdirSync(OUT, { recursive: true });

const sounds = {
  // A short, rounded click: a falling tone that dies away in ~0.15 s.
  pop: { d: 0.2, src: "aevalsrc='0.9*sin(2*PI*(500+1800*exp(-45*t))*t)*exp(-28*t)':s=44100", filter: "afade=t=out:st=0.15:d=0.05" },
  // A soft bell: a fundamental plus an octave, decaying over ~0.8 s.
  ding: { d: 0.9, src: "aevalsrc='0.55*sin(2*PI*1318*t)*exp(-6*t)+0.25*sin(2*PI*2637*t)*exp(-10*t)':s=44100", filter: "afade=t=in:d=0.005,afade=t=out:st=0.75:d=0.15" },
  // Air moving past: band-limited pink noise swelling and fading.
  whoosh: { d: 0.5, src: "anoisesrc=d=0.5:c=pink:a=0.9:r=44100", filter: "highpass=f=400,lowpass=f=4000,afade=t=in:d=0.22:curve=qsin,afade=t=out:st=0.22:d=0.28:curve=qsin,volume=1.4" },
};

for (const [name, { d, src, filter }] of Object.entries(sounds)) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-t", String(d), "-i", src, "-af", filter, "-ac", "1", "-b:a", "128k", `${OUT}/${name}.mp3`], {
    stdio: "inherit",
  });
  console.log(`wrote ${OUT}/${name}.mp3`);
}
