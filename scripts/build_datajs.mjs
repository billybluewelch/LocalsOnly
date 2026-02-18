import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import glob from "fast-glob";

const ROOT = process.cwd();
const INPUT_GLOB = "localsonly_markdown/recommendations/*.md";
const OUTPUT_FILE = "data.js";

function req(obj, key, file) {
  if (obj == null || obj[key] == null || obj[key] === "") {
    throw new Error(`Missing required key "${key}" in ${file}`);
  }
  return obj[key];
}

function asString(v) {
  return (v == null ? "" : String(v)).trim();
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function asNumber(v, file, keyPath) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for "${keyPath}" in ${file}`);
  }
  return n;
}

function normalize(front, file) {
  // Required per your markdown schema
  const name = req(front, "name", file);
  const cuisine = req(front, "cuisine", file);

  const location = req(front, "location", file);
  const neighborhood = req(location, "neighborhood", file);

  const coordinates = req(front, "coordinates", file);
  const lat = asNumber(req(coordinates, "lat", file), file, "coordinates.lat");
  const lng = asNumber(req(coordinates, "lng", file), file, "coordinates.lng");

  // Required in your markdown examples; keep strict if you want schema discipline
  const price = asString(req(front, "price_range", file));
  const rating = asNumber(req(front, "rating_proxy", file), file, "rating_proxy");

  const permalink =
    (typeof front.permalink === "string" && front.permalink.trim()) ||
    path.basename(file, path.extname(file));

  // Optional fields (pass-through only; no invention)
  const tags = asArray(front.tags);
  const why = asString(front.recommendation);

  return {
    // minimal required metadata
    id: permalink,

    // current UI-compatible fields
    name,
    category: cuisine,
    neighborhoods: [neighborhood],
    price,
    rating,
    tags,
    why,

    // schema fields (pass-through)
    phone: asString(front.phone),
    website: asString(front.website),
    address: asString(front.address),
    maps_url: asString(front.maps_url),
    image: asString(front.image),
    top_dishes: asArray(front.top_dishes),
    best_for: asArray(front.best_for),
    dining_type: asString(front.dining_type),
    dietary_options: asArray(front.dietary_options),
    nearish: asArray(front.nearish),
    coordinates: { lat, lng },
    location: { city: asString(location.city) || "Nashville", neighborhood },

    // if you add these later to markdown, they’ll flow through automatically
    hours: front.hours ?? null,
    timezone: asString(front.timezone) || null,
  };
}

async function main() {
  const files = await glob(INPUT_GLOB, { cwd: ROOT, absolute: true });
  if (!files.length) {
    throw new Error(`No markdown files found at: ${INPUT_GLOB}`);
  }

  const rows = [];
  const seen = new Set();

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const parsed = matter(raw);
    const row = normalize(parsed.data, file);

    if (seen.has(row.id)) {
      throw new Error(`Duplicate permalink/id "${row.id}" (file: ${file})`);
    }
    seen.add(row.id);

    rows.push(row);
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  const js = `// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: ${INPUT_GLOB}

window.LOCALSONLY_DATA = ${JSON.stringify(rows, null, 2)};

window.LISTINGS = window.LOCALSONLY_DATA.map((x) => ({
  name: x.name,
  category: x.category,
  neighborhood: (x.neighborhoods && x.neighborhoods[0]) || "",
  price: x.price,
  rating: x.rating,
  // open_now is unknown unless you add hours logic later
  open_now: null,
  why: x.why,
  tags: x.tags || [],

  coordinates: x.coordinates,
  maps_url: x.maps_url,
  address: x.address,
  phone: x.phone,
  website: x.website,
  image: x.image,
  top_dishes: x.top_dishes,
  best_for: x.best_for,
  dining_type: x.dining_type,
  dietary_options: x.dietary_options,
  nearish: x.nearish,
  hours: x.hours,
  timezone: x.timezone
}));
`;

  await fs.writeFile(path.join(ROOT, OUTPUT_FILE), js, "utf8");
  console.log(`Wrote ${rows.length} listings -> ${OUTPUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
