/**
 * Standardizes recommendation markdown frontmatter to a consistent schema.
 * Renames known alias keys to canonical keys only when the canonical key is missing,
 * converts list-like comma-separated strings into arrays, fills missing canonical
 * fields with neutral defaults, preserves existing canonical values, keeps unknown
 * extra keys, and rewrites frontmatter in a consistent key order.
 *
 * Additional normalization in this version:
 * - dedupes list-like arrays case-insensitively while preserving first-seen order
 * - lowercases tags
 * - canonicalizes best_for into cleaner filter values where possible
 */
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import matter from "gray-matter";
import glob from "fast-glob";

const ROOT = process.cwd();
const INPUT_GLOB = "localsonly_markdown/recommendations/*.md";

const WRITE = process.argv.includes("--write");
const YES = process.argv.includes("--yes");

const CANONICAL_ORDER = [
  "name",
  "cuisine",
  "location",
  "coordinates",
  "address",
  "maps_url",
  "phone",
  "website",
  "price_range",
  "dining_type",
  "dietary_options",
  "top_dishes",
  "best_for",
  "tags",
  "nearish",
  "recommendation",
  "image",
  "permalink",
  "rating_proxy",
  "hours",
  "timezone",
  "google_place_id",
];

function cleanString(v) {
  return v == null ? "" : String(v).trim();
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function hasValue(v) {
  return cleanString(v) !== "";
}

function toNumberIfFinite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function splitCsv(value) {
  return cleanString(value)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function uniqueStrings(values, { lowercase = false } = {}) {
  const out = [];
  const seen = new Set();

  for (const value of values) {
    let s = cleanString(value);
    if (!s) continue;

    if (lowercase) {
      s = s.toLowerCase();
    }

    const key = s.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(s);
  }

  return out;
}

function normalizeStringArray(value, options = {}) {
  if (Array.isArray(value)) {
    return uniqueStrings(value, options);
  }

  if (typeof value === "string") {
    return uniqueStrings(splitCsv(value), options);
  }

  return [];
}

function normalizeTagsArray(value) {
  return normalizeStringArray(value, { lowercase: true });
}

function canonicalizeBestFor(value) {
  const raw = normalizeStringArray(value, { lowercase: true });
  const out = [];
  const seen = new Set();

  function push(label) {
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }

  for (const item of raw) {
    const s = item.replace(/&/g, " and ");

    let matched = false;

    if (/\bbreakfast\b/.test(s)) {
      push("breakfast");
      matched = true;
    }

    if (/\bbrunch\b/.test(s)) {
      push("brunch");
      matched = true;
    }

    if (/\blunch\b/.test(s)) {
      push("lunch");
      matched = true;
    }

    if (/\bdinner\b/.test(s)) {
      push("dinner");
      matched = true;
    }

    if (/\blate[\s-]?night\b/.test(s)) {
      push("late-night");
      matched = true;
    }

    if (/\bcoffee\b|\bcafe\b/.test(s)) {
      push("coffee");
      matched = true;
    }

    if (/\bdrink\b|\bdrinks\b|\bcocktail\b|\bcocktails\b|\bbar\b|\bwine\b|\bbeer\b/.test(s)) {
      push("drinks");
      matched = true;
    }

    if (/\bdessert\b|\bice cream\b|\bsweets?\b|\bbakery\b/.test(s)) {
      push("dessert");
      matched = true;
    }

    // Preserve unknown values instead of silently dropping them.
    if (!matched) {
      push(s);
    }
  }

  return out;
}

function arraysEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getFirstValue(data, aliases) {
  for (const key of aliases) {
    if (hasOwn(data, key)) {
      return data[key];
    }
  }
  return undefined;
}

function normalizeLocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const city = hasOwn(value, "city")
    ? value.city
    : hasOwn(value, "City")
    ? value.City
    : undefined;

  const neighborhood = hasOwn(value, "neighborhood")
    ? value.neighborhood
    : hasOwn(value, "Neighborhood")
    ? value.Neighborhood
    : undefined;

  const out = {};

  if (city !== undefined) out.city = cleanString(city);
  if (neighborhood !== undefined) out.neighborhood = cleanString(neighborhood);

  for (const [k, v] of Object.entries(value)) {
    if (k === "city" || k === "City" || k === "neighborhood" || k === "Neighborhood") {
      continue;
    }
    out[k] = v;
  }

  return out;
}

function normalizeCoordinates(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const lat = hasOwn(value, "lat") ? value.lat : undefined;
  const lng = hasOwn(value, "lng") ? value.lng : undefined;

  const out = {};

  if (lat !== undefined) out.lat = toNumberIfFinite(lat);
  if (lng !== undefined) out.lng = toNumberIfFinite(lng);

  for (const [k, v] of Object.entries(value)) {
    if (k === "lat" || k === "lng") continue;
    out[k] = v;
  }

  return out;
}

function resolveCanonicalString(data, canonicalKey, aliasKeys, actions, warnings) {
  const canonicalExists = hasOwn(data, canonicalKey);
  const canonicalValue = canonicalExists ? data[canonicalKey] : undefined;

  let aliasFoundKey = null;
  let aliasValue = undefined;

  for (const key of aliasKeys) {
    if (hasOwn(data, key)) {
      aliasFoundKey = key;
      aliasValue = data[key];
      break;
    }
  }

  if (canonicalExists) {
    if (
      aliasFoundKey &&
      cleanString(canonicalValue) !== cleanString(aliasValue)
    ) {
      warnings.push(
        `${canonicalKey} and ${aliasFoundKey} both exist with different values; keeping ${canonicalKey}`
      );
    } else if (aliasFoundKey) {
      actions.push(`${aliasFoundKey} removed (duplicate of ${canonicalKey})`);
    }
    return cleanString(canonicalValue);
  }

  if (aliasFoundKey) {
    actions.push(`${aliasFoundKey} -> ${canonicalKey}`);
    return cleanString(aliasValue);
  }

  return "";
}

function resolveCanonicalArray(
  data,
  canonicalKey,
  aliasKeys,
  actions,
  warnings,
  normalizer = normalizeStringArray
) {
  const canonicalExists = hasOwn(data, canonicalKey);
  const canonicalValue = canonicalExists ? data[canonicalKey] : undefined;

  let aliasFoundKey = null;
  let aliasValue = undefined;

  for (const key of aliasKeys) {
    if (hasOwn(data, key)) {
      aliasFoundKey = key;
      aliasValue = data[key];
      break;
    }
  }

  if (canonicalExists) {
    const normalizedCanonical = normalizer(canonicalValue);
    const normalizedAlias = aliasFoundKey ? normalizer(aliasValue) : null;

    if (
      aliasFoundKey &&
      !arraysEqual(normalizedCanonical, normalizedAlias)
    ) {
      warnings.push(
        `${canonicalKey} and ${aliasFoundKey} both exist with different values; keeping ${canonicalKey}`
      );
    } else if (aliasFoundKey) {
      actions.push(`${aliasFoundKey} removed (duplicate of ${canonicalKey})`);
    }

    return normalizedCanonical;
  }

  if (aliasFoundKey) {
    actions.push(`${aliasFoundKey} -> ${canonicalKey}`);
    return normalizer(aliasValue);
  }

  return [];
}

function resolveCanonicalRecommendation(data, actions, warnings) {
  return resolveCanonicalString(
    data,
    "recommendation",
    ["Summary", "summary"],
    actions,
    warnings
  );
}

function resolveCanonicalTopDishes(data, actions, warnings) {
  return resolveCanonicalArray(
    data,
    "top_dishes",
    ["Favs", "favs"],
    actions,
    warnings,
    normalizeStringArray
  );
}

function buildCanonicalFrontmatter(data) {
  const actions = [];
  const warnings = [];

  const canonical = {};

  if (hasOwn(data, "name")) canonical.name = cleanString(data.name);
  if (hasOwn(data, "cuisine")) canonical.cuisine = cleanString(data.cuisine);

  if (hasOwn(data, "location")) {
    canonical.location = normalizeLocation(data.location);
  }

  if (hasOwn(data, "coordinates")) {
    canonical.coordinates = normalizeCoordinates(data.coordinates);
  }

  canonical.address = resolveCanonicalString(
    data,
    "address",
    ["Address"],
    actions,
    warnings
  );

  canonical.maps_url = resolveCanonicalString(
    data,
    "maps_url",
    ["Map", "map", "maps"],
    actions,
    warnings
  );

  if (hasOwn(data, "phone")) {
    canonical.phone = cleanString(data.phone);
  } else {
    canonical.phone = "";
    actions.push('phone added as empty string');
  }

  canonical.website = resolveCanonicalString(
    data,
    "website",
    ["site", "Website"],
    actions,
    warnings
  );

  if (!hasOwn(data, "website") && !hasOwn(data, "site") && !hasOwn(data, "Website")) {
    actions.push('website added as empty string');
  }

  if (!hasOwn(data, "maps_url") && !hasOwn(data, "Map") && !hasOwn(data, "map") && !hasOwn(data, "maps")) {
    actions.push('maps_url added as empty string');
  }

  if (hasOwn(data, "price_range")) {
    canonical.price_range = cleanString(data.price_range);
  }

  if (hasOwn(data, "dining_type")) {
    canonical.dining_type = cleanString(data.dining_type);
  } else {
    canonical.dining_type = "";
    actions.push('dining_type added as empty string');
  }

  if (hasOwn(data, "dietary_options")) {
    const rawDietary = normalizeStringArray(data.dietary_options);
    canonical.dietary_options = rawDietary;
  } else {
    canonical.dietary_options = [];
    actions.push('dietary_options added as empty list');
  }

  canonical.top_dishes = resolveCanonicalTopDishes(data, actions, warnings);
  if (!hasOwn(data, "top_dishes") && !hasOwn(data, "Favs") && !hasOwn(data, "favs")) {
    actions.push('top_dishes added as empty list');
  }

  if (hasOwn(data, "best_for")) {
    const rawBestFor = normalizeStringArray(data.best_for);
    const canonicalBestFor = canonicalizeBestFor(data.best_for);
    canonical.best_for = canonicalBestFor;

    if (!arraysEqual(rawBestFor, canonicalBestFor)) {
      actions.push('best_for standardized to canonical filter labels');
    }
  } else {
    canonical.best_for = [];
    actions.push('best_for added as empty list');
  }

  canonical.tags = resolveCanonicalArray(
    data,
    "tags",
    ["Tags"],
    actions,
    warnings,
    normalizeTagsArray
  );
  if (!hasOwn(data, "tags") && !hasOwn(data, "Tags")) {
    actions.push('tags added as empty list');
  } else {
    const originalTags = hasOwn(data, "tags")
      ? normalizeStringArray(data.tags)
      : hasOwn(data, "Tags")
      ? normalizeStringArray(data.Tags)
      : [];
    if (!arraysEqual(originalTags, canonical.tags)) {
      actions.push('tags normalized to lowercase unique values');
    }
  }

  canonical.nearish = resolveCanonicalArray(
    data,
    "nearish",
    ["Nearish"],
    actions,
    warnings,
    normalizeStringArray
  );
  if (!hasOwn(data, "nearish") && !hasOwn(data, "Nearish")) {
    actions.push('nearish added as empty list');
  }

  canonical.recommendation = resolveCanonicalRecommendation(data, actions, warnings);
  if (!hasOwn(data, "recommendation") && !hasOwn(data, "Summary") && !hasOwn(data, "summary")) {
    actions.push('recommendation added as empty string');
  }

  if (hasOwn(data, "image")) {
    canonical.image = cleanString(data.image);
  } else if (hasOwn(data, "Image")) {
    canonical.image = cleanString(data.Image);
    actions.push('Image -> image');
  } else {
    canonical.image = "";
    actions.push('image added as empty string');
  }

  if (hasOwn(data, "permalink")) {
    const permalink = cleanString(data.permalink);

    if (permalink) {
      canonical.permalink = permalink;
    } else {
      actions.push("empty permalink removed");
    }
  }

  if (hasOwn(data, "rating_proxy")) {
    canonical.rating_proxy = data.rating_proxy;
  }

  if (hasOwn(data, "hours")) {
    canonical.hours = data.hours;
  }

  if (hasOwn(data, "timezone")) {
    canonical.timezone = data.timezone;
  }

  if (hasOwn(data, "google_place_id")) {
    canonical.google_place_id = data.google_place_id;
  }

  const consumedKeys = new Set([
    "name",
    "cuisine",
    "location",
    "coordinates",
    "address",
    "Address",
    "maps_url",
    "Map",
    "map",
    "maps",
    "phone",
    "website",
    "Website",
    "site",
    "price_range",
    "dining_type",
    "dietary_options",
    "top_dishes",
    "Favs",
    "favs",
    "best_for",
    "tags",
    "Tags",
    "nearish",
    "Nearish",
    "recommendation",
    "Summary",
    "summary",
    "image",
    "Image",
    "permalink",
    "rating_proxy",
    "hours",
    "timezone",
    "google_place_id",
  ]);

  const extras = {};
  for (const [key, value] of Object.entries(data)) {
    if (!consumedKeys.has(key)) {
      extras[key] = value;
    }
  }

  const ordered = {};
  for (const key of CANONICAL_ORDER) {
    if (hasOwn(canonical, key)) {
      ordered[key] = canonical[key];
    }
  }

  for (const key of Object.keys(extras).sort()) {
    ordered[key] = extras[key];
  }

  return { ordered, actions, warnings };
}

async function readFiles() {
  const files = await glob(INPUT_GLOB, { cwd: ROOT, absolute: true });
  if (!files.length) {
    throw new Error(`No markdown files found at: ${INPUT_GLOB}`);
  }
  return files;
}

async function askToContinue(count) {
  if (YES) return true;

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Write standardized frontmatter to ${count} file(s)? Type "y" to continue: `
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const files = await readFiles();
  const results = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const parsed = matter(raw);
    const data = parsed.data || {};

    const { ordered, actions, warnings } = buildCanonicalFrontmatter(data);

    const before = JSON.stringify(data);
    const after = JSON.stringify(ordered);

    if (before !== after || warnings.length) {
      results.push({
        file,
        basename: path.basename(file),
        parsed,
        ordered,
        actions,
        warnings,
      });
    }
  }

  console.log("");
  console.log("=== Recommendation frontmatter standardization summary ===");
  console.log(`Files scanned: ${files.length}`);
  console.log(`Files needing rewrite/review: ${results.length}`);
  console.log("");

  if (!results.length) {
    console.log("Everything already matches the requested canonical schema.");
    return;
  }

  for (const item of results) {
    console.log(`- ${item.basename}`);
    if (item.actions.length) {
      for (const action of item.actions) {
        console.log(`    action:  ${action}`);
      }
    } else {
      console.log(`    action:  frontmatter reordered only`);
    }

    for (const warning of item.warnings) {
      console.log(`    warning: ${warning}`);
    }
  }

  if (!WRITE) {
    console.log("");
    console.log("Dry run only. Re-run with --write to apply changes.");
    return;
  }

  const proceed = await askToContinue(results.length);
  if (!proceed) {
    console.log("Aborted. No files were changed.");
    return;
  }

  for (const item of results) {
    const out = matter.stringify(item.parsed.content, item.ordered);
    await fs.writeFile(item.file, out, "utf8");
    console.log(`[WROTE] ${item.basename}`);
  }

  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});