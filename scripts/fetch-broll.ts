// Spike step 5 (asset): download one portrait b-roll photo from Pixabay.
// Run from the repo root:  node scripts/fetch-broll.ts "city trees"
// Writes spike/assets/broll.jpg and spike/assets/broll-credit.json.
//
// Pixabay API rules (https://pixabay.com/api/docs/): no permanent hotlinking, so we
// download the file; show users where media comes from; 100 requests / 60 s per key.
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

process.loadEnvFile(".env");
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;
if (!PIXABAY_API_KEY) throw new Error("PIXABAY_API_KEY is missing from .env");

const query = process.argv[2] ?? "newspaper reading";
const ASSETS = join("spike", "assets");

const url = new URL("https://pixabay.com/api/");
url.searchParams.set("key", PIXABAY_API_KEY);
url.searchParams.set("q", query);
url.searchParams.set("image_type", "photo");
url.searchParams.set("orientation", "vertical");
url.searchParams.set("safesearch", "true");
url.searchParams.set("per_page", "3"); // API minimum

const res = await fetch(url);
if (!res.ok) throw new Error(`Pixabay search failed: ${res.status} ${await res.text()}`);
const { hits } = await res.json();
if (!hits?.length) throw new Error(`No Pixabay photos for "${query}"`);

const photo = hits[0];
// largeImageURL is up to 1280px on the long side; larger sizes need approved full API access.
const img = await fetch(photo.largeImageURL);
if (!img.ok) throw new Error(`Image download failed: ${img.status}`);

await mkdir(ASSETS, { recursive: true });
await writeFile(join(ASSETS, "broll.jpg"), Buffer.from(await img.arrayBuffer()));
await writeFile(
  join(ASSETS, "broll-credit.json"),
  JSON.stringify({ source: "Pixabay", query, id: photo.id, user: photo.user, pageURL: photo.pageURL }, null, 2),
);
console.log(`Saved Pixabay photo ${photo.id} by ${photo.user} (${photo.pageURL})`);
