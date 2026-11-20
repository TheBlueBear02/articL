// Load the repo-root .env (shared with the spike scripts), then run the given command.
// Usage: node scripts/with-root-env.mjs next dev
// On Vercel there is no .env file; env vars come from the project settings instead.
import { existsSync, readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Trust the certificates Windows trusts. Networks that inspect HTTPS (common on managed
// machines) otherwise make every call to Supabase fail with SELF_SIGNED_CERT_IN_CHAIN.
// Verification stays on; Node just uses the OS certificate store like the browser does.
process.env.NODE_USE_SYSTEM_CA ??= "1";

// Local video renders need FFmpeg on PATH. A winget install only updates PATH for shells
// opened afterwards, so if it isn't found, look in winget's package folder (Windows only).
function ensureFfmpegOnPath() {
  const found = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { stdio: "ignore" });
  if (found.status === 0 || process.platform !== "win32" || !process.env.LOCALAPPDATA) return;
  const pkgs = path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
  if (!existsSync(pkgs)) return;
  for (const pkg of readdirSync(pkgs).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
    for (const build of readdirSync(path.join(pkgs, pkg))) {
      const bin = path.join(pkgs, pkg, build, "bin");
      if (existsSync(path.join(bin, "ffmpeg.exe"))) {
        process.env.PATH = `${process.env.PATH}${path.delimiter}${bin}`;
        return;
      }
    }
  }
}
ensureFfmpegOnPath();

const command = process.argv.slice(2).join(" ");
const child = spawn(command, { stdio: "inherit", shell: true, env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
