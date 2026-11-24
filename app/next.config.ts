import os from "node:os";
import type { NextConfig } from "next";

/** Every IPv4 on this machine, so phone/LAN access keeps working when DHCP changes the IP. */
function lanDevHosts() {
  const hosts = new Set<string>(["127.0.0.1"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" || a.family === 4) hosts.add(a.address);
    }
  }
  return [...hosts];
}

// Env vars come from the repo-root .env, passed in by the npm scripts (node --env-file).
const nextConfig: NextConfig = {
  // Phone / LAN access: without this, Next blocks /_next in development and the page never hydrates.
  allowedDevOrigins: lanDevHosts(),
  cacheComponents: true,
  // Native module (draws the "Paper page" add-on's PDF page): load it from node_modules, don't bundle it.
  serverExternalPackages: ["@napi-rs/canvas"],
  partialPrefetching: true,
  // Next 16.4 Turbopack can reload the tab forever after a restart/LAN reconnect; this stops that loop.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
