// Map intro: find the study's country and draw a world map that the composition zooms into.
// Country shapes: Natural Earth (public domain) via the world-atlas package; drawn as SVG on the
// server, so rendering needs no map tiles or network. Country level only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { geoArea, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import type { MapScene } from "./composition";

type Country = Feature<Geometry, { name: string }>;
type Topo = Parameters<typeof feature>[0];

const cache = new Map<string, Country[]>();
/** Countries at a Natural Earth resolution ("110m" for the world, "50m" for the highlighted one). */
function countries(res: "110m" | "50m", dir = path.join(process.cwd(), "node_modules", "world-atlas")): Country[] {
  const key = `${dir}|${res}`;
  if (!cache.has(key)) {
    const topo = JSON.parse(readFileSync(path.join(dir, `countries-${res}.json`), "utf8")) as Topo & {
      objects: { countries: Parameters<typeof feature>[1] };
    };
    const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
    cache.set(key, fc.features);
  }
  return cache.get(key)!;
}

/** Places the article names that aren't Natural Earth country names. */
const ALIASES: [RegExp, string][] = [
  [/\b(England|Scotland|Wales|Northern Ireland|Britain|Great Britain|United Kingdom)\b/i, "United Kingdom"],
  [/\b(UK|U\.K\.)(?![a-z])/, "United Kingdom"],
  [/\b(United States|America)\b/i, "United States of America"],
  [/\b(USA|US|U\.S\.A?\.?)(?![a-z])/, "United States of America"],
  [/\b(Czech Republic|Czechia)\b/i, "Czechia"],
  [/\b(South Korea|Korea)\b/i, "South Korea"],
  [/\b(Democratic Republic of the Congo|DR Congo|DRC)\b/i, "Dem. Rep. Congo"],
];

export type CountryMatch = {
  /** Natural Earth name, used to find the shape. */
  name: string;
  /** How the article writes it ("England", "Afghanistan"): the map's label. */
  label: string;
  /** Words the narration may use for it, to time the map ("Afghan" matches "Afghanistan"). */
  words: string[];
};

/**
 * The country in a study's place ("250 villages across Afghanistan" -> Afghanistan), or null.
 * Only names written in the verified place are used: an alias table for a few common ones, the
 * Natural Earth names, then a demonym prefix ("Afghan", "Kenyan") that fits exactly one country.
 */
export function findCountry(place: string | undefined, dir?: string): CountryMatch | null {
  if (!place?.trim()) return null;
  const names = countries("110m", dir).map((c) => c.properties.name);
  for (const [re, name] of ALIASES) {
    const m = place.match(re);
    if (m && names.includes(name)) return { name, label: m[1], words: [m[1], ...name.split(" ")] };
  }
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const m = place.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
    if (m) return { name, label: m[0], words: [m[0]] };
  }
  for (const word of place.match(/\b[A-Z][a-z]{4,}\b/g) ?? []) {
    const prefix = word.slice(0, 5).toLowerCase();
    const hits = names.filter((n) => n.toLowerCase().startsWith(prefix));
    if (hits.length === 1) return { name: hits[0], label: hits[0], words: [word, hits[0]] };
  }
  return null;
}

/** Words in a place that aren't names of their own ("East Java" is said as "Java"). */
const NOT_A_NAME = new Set(["east", "west", "north", "south", "central", "eastern", "western", "northern", "southern", "the", "province", "provinces", "region", "district", "state", "city", "rural", "urban"]);

/** The study place's own names, e.g. "608 villages in East Java and Central Java, Indonesia" -> ["Java", "Indonesia"]. */
export function placeNames(place: string | undefined): string[] {
  const names = (place ?? "").match(/\b[A-Z][a-zA-Z]+\b/g) ?? [];
  return [...new Set(names.filter((w) => !NOT_A_NAME.has(w.toLowerCase())))];
}

/** "2007 to 2011" -> "2007–2011"; "April to July 2016 (with a follow-up July 2017)" -> "2016–2017". */
export function periodLabel(period: string | undefined): string {
  const years = [...new Set(period?.match(/\b(?:19|20)\d{2}\b/g) ?? [])].map(Number).sort((a, b) => a - b);
  if (!years.length) return "";
  return years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
}

/** The country's largest piece, so France's map ends on France, not between Paris and Guiana. */
function mainland(c: Country): Feature<Polygon> {
  const g = c.geometry as Polygon | MultiPolygon;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const pieces = polys.map((coordinates) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates } }));
  return pieces.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
}

const W = 1080;
/** The country fills about this many pixels at the end of the zoom. */
const COUNTRY_PX = 340;

/**
 * The map scene for a country: the whole world across the frame width at the start, ending with the
 * country centred at `focusY` inside a panel `height` px tall (1920, or 960 on split screen).
 */
export function buildMapScene(countryName: string, height: number, focusY: number, dir?: string): MapScene {
  const sphere = { type: "Sphere" } as const;
  const projection = geoNaturalEarth1().fitWidth(W, sphere);
  const draw = geoPath(projection).digits(1);
  const worldH = draw.bounds(sphere)[1][1];

  const world = countries("110m", dir);
  const target = countries("50m", dir).find((c) => c.properties.name === countryName) ?? world.find((c) => c.properties.name === countryName);
  if (!target) throw new Error(`No map shape for "${countryName}"`);

  const main = mainland(target);
  const [[x0, y0], [x1, y1]] = draw.bounds(main);
  const [cx, cy] = draw.centroid(main);
  const scale = Math.min(60, Math.max(1.2, COUNTRY_PX / Math.max(x1 - x0, y1 - y0, 1)));
  const pinR = 9 / scale;

  const others = world
    .filter((c) => c.properties.name !== countryName)
    .map((c) => draw(c))
    .filter(Boolean)
    .join("");
  const viewBox = [0, worldH / 2 - height / 2, W, height].map((v) => v.toFixed(1)).join(" ");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none">` +
    `<path d="${draw(sphere)}" fill="#12263a"/>` +
    `<path d="${others}" fill="#2a4159" stroke="#4d6884" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    `<path d="${draw(target)}" fill="#ffd60a" stroke="#ffffff" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
    `<circle id="mapring" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${pinR.toFixed(3)}" fill="none" stroke="#ffffff" stroke-width="3" vector-effect="non-scaling-stroke" opacity="0"/>` +
    `<circle id="mappin" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${pinR.toFixed(3)}" fill="#111111" stroke="#ffffff" stroke-width="3" vector-effect="non-scaling-stroke" opacity="0"/>` +
    `</svg>`;

  return {
    svg,
    height,
    from: { x: W / 2, y: worldH / 2 },
    to: { x: cx, y: cy },
    scale,
    focusY,
    pin: { x: cx, y: cy, r: pinR },
  };
}
