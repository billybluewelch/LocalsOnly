import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import matter from "gray-matter";
import glob from "fast-glob";

const ROOT = process.cwd();
const INPUT_GLOB = "localsonly_markdown/recommendations/*.md";
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Current pricing defaults for estimate output only.
// Override with env vars if Google pricing changes.
const TEXT_SEARCH_ENTERPRISE_USD_PER_1000 = Number(
  process.env.GOOGLE_TEXT_SEARCH_ENTERPRISE_USD_PER_1000 || "35"
);
const TEXT_SEARCH_ENTERPRISE_FREE_CAP = Number(
  process.env.GOOGLE_TEXT_SEARCH_ENTERPRISE_FREE_CAP || "1000"
);

// Looser safeguard thresholds.
// These are meant to reject clearly bad candidates without filtering out likely correct ones.
const PAGE_SIZE = Number(process.env.GOOGLE_PLACES_PAGE_SIZE || "5");
const MIN_NAME_OVERLAP = Number(process.env.GOOGLE_MIN_NAME_OVERLAP || "0.25");
const MIN_ACCEPT_SCORE = Number(process.env.GOOGLE_MIN_ACCEPT_SCORE || "0.42");
const MIN_SCORE_GAP = Number(process.env.GOOGLE_MIN_SCORE_GAP || "0.02");

// Flags
const FORCE_YES = process.argv.includes("--yes");
const REFRESH_ALL = process.argv.includes("--refresh-all");
const CATALOG_ONLY = process.argv.includes("--catalog-only");

// Bias search toward Nashville for better match quality.
const NASHVILLE_BIAS = {
  circle: {
    center: { latitude: 36.1627, longitude: -86.7816 },
    radius: 30000.0,
  },
};

// One Text Search request per business.
// Includes validation fields and coordinates.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.regularOpeningHours",
  "places.timeZone",
  "places.businessStatus",
  "places.primaryType",
  "places.location",
  "places.rating",
  "places.userRatingCount",
].join(",");

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function cleanString(v) {
  return v == null ? "" : String(v).trim();
}

function hasNonEmptyString(v) {
  return cleanString(v) !== "";
}

function firstPresent(obj, keys) {
  for (const key of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, key) &&
      hasNonEmptyString(obj[key])
    ) {
      return obj[key];
    }
  }
  return "";
}

function getName(data, file) {
  const name = cleanString(firstPresent(data, ["name"]));
  if (!name) {
    throw new Error(`Missing "name" in ${file}`);
  }
  return name;
}

function getAddress(data) {
  return cleanString(firstPresent(data, ["address", "Address"]));
}

function getCity(data) {
  return cleanString(data?.location?.city) || "Nashville";
}

function getNeighborhood(data) {
  return cleanString(data?.location?.neighborhood);
}

function getExistingCoordinates(data) {
  const lat = Number(data?.coordinates?.lat);
  const lng = Number(data?.coordinates?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return null;
}

function hasMissingOrZeroCoordinates(data) {
  const coords = getExistingCoordinates(data);
  if (!coords) return true;

  const { lat, lng } = coords;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return true;
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return true;

  return false;
}

function buildQuery(data, file) {
  const name = getName(data, file);
  const address = getAddress(data);
  const city = getCity(data);
  return [name, address, city, "TN"].filter(Boolean).join(", ");
}

function normalizeName(s) {
  return cleanString(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(s) {
  return new Set(normalizeName(s).split(/\s+/).filter(Boolean));
}

function tokenOverlap(a, b) {
  const as = tokenSet(a);
  const bs = tokenSet(b);
  if (!as.size || !bs.size) return 0;

  let hits = 0;
  for (const tok of as) {
    if (bs.has(tok)) hits += 1;
  }
  return hits / Math.max(as.size, bs.size);
}

function normalizedContainsEitherWay(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

function formatUsd(value) {
  return `$${value.toFixed(4)}`;
}

function format12h(hour, minute) {
  const h24 = Number(hour || 0);
  const min = Number(minute || 0);
  const suffix = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

function emptyHoursObject() {
  return Object.fromEntries(DAY_KEYS.map((d) => [d, []]));
}

function isAlwaysOpenPeriod(period) {
  return (
    period &&
    period.open &&
    period.open.day === 0 &&
    Number(period.open.hour || 0) === 0 &&
    Number(period.open.minute || 0) === 0 &&
    !period.close
  );
}

function googleHoursToFrontmatter(regularOpeningHours) {
  if (!regularOpeningHours || !Array.isArray(regularOpeningHours.periods)) {
    return null;
  }

  const periods = regularOpeningHours.periods;

  if (periods.length === 1 && isAlwaysOpenPeriod(periods[0])) {
    return Object.fromEntries(
      DAY_KEYS.map((d) => [d, [{ open: "12:00 AM", close: "11:59 PM" }]])
    );
  }

  const out = emptyHoursObject();

  for (const period of periods) {
    const open = period?.open;
    const close = period?.close;

    if (!open || open.day == null) continue;

    const openDay = DAY_KEYS[Number(open.day)];
    if (!openDay) continue;

    const openStr = format12h(open.hour, open.minute);

    if (!close || close.day == null) continue;

    const closeStr = format12h(close.hour, close.minute);

    out[openDay].push({
      open: openStr,
      close: closeStr,
    });
  }

  return out;
}

function hasUsableHours(hours) {
  if (!hours || typeof hours !== "object") return false;
  for (const value of Object.values(hours)) {
    if (Array.isArray(value) && value.length > 0) return true;
    if (typeof value === "string" && value.trim() !== "") return true;
    if (value && typeof value === "object" && !Array.isArray(value)) return true;
  }
  return false;
}

function getMissingTargets(data) {
  const missing = [];

  const hasWebsite = hasNonEmptyString(firstPresent(data, ["website", "site"]));
  const hasMapsUrl = hasNonEmptyString(firstPresent(data, ["maps_url", "Map", "map", "maps"]));
  const hasHours = hasUsableHours(data.hours);

  if (!hasWebsite) missing.push("website");
  if (!hasMapsUrl) missing.push("maps_url");
  if (!hasHours) missing.push("hours");

  return missing;
}

function shouldProcess(data) {
  return REFRESH_ALL || getMissingTargets(data).length > 0 || hasMissingOrZeroCoordinates(data);
}

async function readCatalog() {
  const files = await glob(INPUT_GLOB, { cwd: ROOT, absolute: true });
  if (!files.length) {
    throw new Error(`No markdown files found at: ${INPUT_GLOB}`);
  }

  const catalog = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const parsed = matter(raw);
    const data = parsed.data || {};

    const missing = getMissingTargets(data);

    catalog.push({
      file,
      basename: path.basename(file),
      parsed,
      data,
      name: getName(data, file),
      address: getAddress(data),
      city: getCity(data),
      neighborhood: getNeighborhood(data),
      coordinatesMissingOrZero: hasMissingOrZeroCoordinates(data),
      query: buildQuery(data, file),
      missing,
      shouldProcess: shouldProcess(data),
    });
  }

  return catalog;
}

function printCatalogSummary(catalog) {
  const candidates = catalog.filter((x) => x.shouldProcess);

  const missingWebsite = catalog.filter((x) => x.missing.includes("website")).length;
  const missingMaps = catalog.filter((x) => x.missing.includes("maps_url")).length;
  const missingHours = catalog.filter((x) => x.missing.includes("hours")).length;
  const missingCoords = catalog.filter((x) => x.coordinatesMissingOrZero).length;

  const requestCount = candidates.length;
  const grossEstimate = (requestCount * TEXT_SEARCH_ENTERPRISE_USD_PER_1000) / 1000;
  const bestCaseAfterFullFreeCap = (
    Math.max(0, requestCount - TEXT_SEARCH_ENTERPRISE_FREE_CAP) *
    TEXT_SEARCH_ENTERPRISE_USD_PER_1000
  ) / 1000;

  console.log("");
  console.log("=== Recommendation enrichment catalog ===");
  console.log(`Total markdown files:            ${catalog.length}`);
  console.log(`Files to query this run:         ${requestCount}`);
  console.log(`Missing website:                 ${missingWebsite}`);
  console.log(`Missing Google Maps link:        ${missingMaps}`);
  console.log(`Missing hours:                   ${missingHours}`);
  console.log(`Missing/zero coordinates:        ${missingCoords}`);
  console.log("");
  console.log("Estimated Text Search Enterprise cost:");
  console.log(`  Gross estimate:                ${formatUsd(grossEstimate)}`);
  console.log(
    `  Best-case after full free cap: ${formatUsd(bestCaseAfterFullFreeCap)} ` +
      `(assumes you still have the full ${TEXT_SEARCH_ENTERPRISE_FREE_CAP} free requests left this month)`
  );
  console.log("");
  console.log(`Rate used for estimate: ${formatUsd(TEXT_SEARCH_ENTERPRISE_USD_PER_1000)} per 1,000 requests`);
  console.log("");
  console.log("Safeguards enabled:");
  console.log(`  pageSize:                      ${PAGE_SIZE}`);
  console.log(`  min name overlap:              ${MIN_NAME_OVERLAP}`);
  console.log(`  min accepted score:            ${MIN_ACCEPT_SCORE}`);
  console.log(`  min best-vs-second gap:        ${MIN_SCORE_GAP}`);
  console.log(`  markdown coordinates used:     no`);
  console.log(`  google coordinates filled:     yes (when missing or 0,0)`);
  console.log("");

  if (!candidates.length) {
    console.log("No files need updates.");
    return;
  }

  console.log("Files that will be queried:");
  for (const item of candidates) {
    const missingBits = [...item.missing];
    if (item.coordinatesMissingOrZero) {
      missingBits.push("coordinates");
    }
    const label = missingBits.length ? missingBits.join(", ") : "refresh-all";
    console.log(`- ${item.basename}  [missing: ${label}]`);
  }
  console.log("");
}

async function askToContinue(requestCount) {
  if (FORCE_YES) return true;
  if (CATALOG_ONLY) return false;

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Proceed with ${requestCount} Google Places request(s)? Type "y" to continue: `
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function searchGooglePlace(textQuery) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      pageSize: PAGE_SIZE,
      languageCode: "en",
      regionCode: "US",
      locationBias: NASHVILLE_BIAS,
    }),
  });

  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(`Google Places error ${res.status}: ${bodyText}`);
  }

  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`Could not parse Places response JSON: ${bodyText}`);
  }

  return Array.isArray(json?.places) ? json.places : [];
}

function setIfBlank(obj, key, value) {
  if (!hasNonEmptyString(value)) return;
  if (!hasNonEmptyString(obj[key])) {
    obj[key] = value;
  }
}

function setAlways(obj, key, value) {
  if (!hasNonEmptyString(value)) return;
  obj[key] = value;
}

function getPlaceName(place) {
  return typeof place?.displayName === "object"
    ? cleanString(place.displayName.text)
    : cleanString(place?.displayName);
}

function getPlaceAddress(place) {
  return cleanString(place?.formattedAddress);
}

function getPlaceShortAddress(place) {
  return cleanString(place?.shortFormattedAddress);
}

function getPlaceCoords(place) {
  const lat = Number(place?.location?.latitude);
  const lng = Number(place?.location?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return null;
}

function setCoordinatesIfMissingOrZero(obj, coords) {
  if (!coords) return;
  if (hasMissingOrZeroCoordinates(obj)) {
    obj.coordinates = coords;
  }
}

function setCoordinatesAlways(obj, coords) {
  if (!coords) return;
  obj.coordinates = coords;
}

function scoreCandidate(item, place) {
  const googleName = getPlaceName(place);
  const googleAddress = getPlaceAddress(place);
  const shortAddress = getPlaceShortAddress(place);
  const businessStatus = cleanString(place?.businessStatus);
  const primaryType = cleanString(place?.primaryType);
  const rating = Number(place?.rating);
  const userRatingCount = Number(place?.userRatingCount);

  const result = {
    place,
    googleName,
    googleAddress,
    shortAddress,
    businessStatus,
    primaryType,
    rating: Number.isFinite(rating) ? rating : null,
    userRatingCount: Number.isFinite(userRatingCount) ? userRatingCount : null,
    nameOverlap: 0,
    addressOverlap: 0,
    neighborhoodOverlap: 0,
    score: 0,
    hardReject: false,
    rejectReasons: [],
  };

  result.nameOverlap = tokenOverlap(item.name, googleName);
  const nameContains = normalizedContainsEitherWay(item.name, googleName);

  if (hasNonEmptyString(item.address)) {
    result.addressOverlap = tokenOverlap(
      item.address,
      `${googleAddress} ${shortAddress}`.trim()
    );
  }

  if (hasNonEmptyString(item.neighborhood)) {
    result.neighborhoodOverlap = tokenOverlap(
      item.neighborhood,
      `${googleAddress} ${shortAddress}`.trim()
    );
  }

  // Hard reject only clearly unlikely matches.
  if (
    result.nameOverlap < MIN_NAME_OVERLAP &&
    !nameContains &&
    result.addressOverlap < 0.35 &&
    result.neighborhoodOverlap < 0.35
  ) {
    result.hardReject = true;
    result.rejectReasons.push(
      `weak overall textual match (name=${result.nameOverlap.toFixed(2)}, address=${result.addressOverlap.toFixed(2)}, neighborhood=${result.neighborhoodOverlap.toFixed(2)})`
    );
  }

  if (businessStatus && businessStatus !== "OPERATIONAL") {
    result.hardReject = true;
    result.rejectReasons.push(`businessStatus=${businessStatus}`);
  }

  // Score weights: name + address dominate, neighborhood/city support.
  result.score += result.nameOverlap * 0.45;
  result.score += result.addressOverlap * 0.30;
  result.score += result.neighborhoodOverlap * 0.08;

  if (nameContains) {
    result.score += 0.10;
  }

  const googleAddressLower = googleAddress.toLowerCase();
  if (item.city && googleAddressLower.includes(item.city.toLowerCase())) {
    result.score += 0.05;
  }

  if (hasNonEmptyString(item.neighborhood) &&
      googleAddressLower.includes(item.neighborhood.toLowerCase())) {
    result.score += 0.03;
  }

  if (businessStatus === "OPERATIONAL") {
    result.score += 0.03;
  }

  if (primaryType) {
    const likelyFoodyTypes = new Set([
      "restaurant",
      "cafe",
      "coffee_shop",
      "bar",
      "bakery",
      "hamburger_restaurant",
      "pizza_restaurant",
      "thai_restaurant",
      "brunch_restaurant",
      "sandwich_shop",
      "barbecue_restaurant",
      "diner",
      "grocery_store",
      "market",
    ]);
    if (likelyFoodyTypes.has(primaryType)) {
      result.score += 0.02;
    }
  }

  if (Number.isFinite(userRatingCount) && userRatingCount > 20 && Number.isFinite(rating)) {
    result.score += 0.02;
  }

  return result;
}

function chooseBestCandidate(item, places) {
  const scored = places.map((place) => scoreCandidate(item, place));
  const viable = scored
    .filter((x) => !x.hardReject)
    .sort((a, b) => b.score - a.score);

  const rejected = scored.filter((x) => x.hardReject);

  if (!viable.length) {
    return {
      accepted: null,
      rejected,
      viable,
      reason: "no candidates passed safeguards",
    };
  }

  const best = viable[0];
  const second = viable[1] || null;

  if (best.score < MIN_ACCEPT_SCORE) {
    return {
      accepted: null,
      rejected,
      viable,
      reason: `best score ${best.score.toFixed(2)} is below threshold ${MIN_ACCEPT_SCORE.toFixed(2)}`,
    };
  }

  if (second && best.score - second.score < MIN_SCORE_GAP) {
    return {
      accepted: null,
      rejected,
      viable,
      reason:
        `best-vs-second score gap ${(best.score - second.score).toFixed(2)} ` +
        `is below threshold ${MIN_SCORE_GAP.toFixed(2)}`,
    };
  }

  return {
    accepted: best,
    rejected,
    viable,
    reason: null,
  };
}

function printCandidateDebug(item, result) {
  console.warn(`\n[REVIEW NEEDED] ${item.basename}`);
  console.warn(`  Query:  ${item.query}`);
  console.warn(`  Reason: ${result.reason}`);

  if (result.viable.length) {
    console.warn(`  Top viable candidates:`);
    for (const cand of result.viable.slice(0, 3)) {
      console.warn(
        `    - ${cand.googleName} | score=${cand.score.toFixed(2)} | ` +
          `name=${cand.nameOverlap.toFixed(2)} | addr=${cand.addressOverlap.toFixed(2)} | ` +
          `nbr=${cand.neighborhoodOverlap.toFixed(2)} | ` +
          `status=${cand.businessStatus || "n/a"} | type=${cand.primaryType || "n/a"}`
      );
      console.warn(`      ${cand.googleAddress}`);
    }
  }

  if (result.rejected.length) {
    console.warn(`  Rejected candidates:`);
    for (const cand of result.rejected.slice(0, 3)) {
      console.warn(
        `    - ${cand.googleName} | reasons=${cand.rejectReasons.join("; ")}`
      );
      console.warn(`      ${cand.googleAddress}`);
    }
  }
}

async function enrichOne(item) {
  const { basename, parsed, data, query, file } = item;

  const places = await searchGooglePlace(query);
  if (!places.length) {
    console.warn(`\n[NO MATCH] ${basename} :: ${query}`);
    return false;
  }

  const selection = chooseBestCandidate(item, places);
  if (!selection.accepted) {
    printCandidateDebug(item, selection);
    return false;
  }

  const best = selection.accepted;
  const place = best.place;

  const website = cleanString(place.websiteUri);
  const mapsUrl = cleanString(place.googleMapsUri);
  const timezone =
    cleanString(place?.timeZone?.id) || cleanString(place?.timeZone);
  const placeId = cleanString(place.id);
  const hours = googleHoursToFrontmatter(place.regularOpeningHours);
  const googleCoords = getPlaceCoords(place);

  if (REFRESH_ALL) {
    setAlways(data, "website", website);
    setAlways(data, "maps_url", mapsUrl);
    if (hours) data.hours = hours;
    setAlways(data, "timezone", timezone);
    setAlways(data, "google_place_id", placeId);
    if (!hasNonEmptyString(data.address)) {
      setAlways(data, "address", best.googleAddress);
    }
    setCoordinatesAlways(data, googleCoords);
  } else {
    setIfBlank(data, "website", website);
    setIfBlank(data, "maps_url", mapsUrl);
    if (!hasUsableHours(data.hours) && hours) {
      data.hours = hours;
    }
    if (!hasNonEmptyString(data.timezone)) {
      setIfBlank(data, "timezone", timezone);
    }
    if (!hasNonEmptyString(data.google_place_id)) {
      setIfBlank(data, "google_place_id", placeId);
    }
    if (!hasNonEmptyString(data.address)) {
      setIfBlank(data, "address", best.googleAddress);
    }
    setCoordinatesIfMissingOrZero(data, googleCoords);
  }

  const out = matter.stringify(parsed.content, data);
  await fs.writeFile(file, out, "utf8");

  console.log(
    `\n[UPDATED] ${basename}\n` +
      `  Query:      ${query}\n` +
      `  Match:      ${best.googleName}\n` +
      `  Address:    ${best.googleAddress}\n` +
      `  Website:    ${website || "(none)"}\n` +
      `  Maps URL:   ${mapsUrl || "(none)"}\n` +
      `  Timezone:   ${timezone || "(none)"}\n` +
      `  Hours:      ${hours ? "yes" : "no"}\n` +
      `  Place ID:   ${placeId || "(none)"}\n` +
      `  Coords:     ${googleCoords ? `${googleCoords.lat}, ${googleCoords.lng}` : "(none)"}\n` +
      `  Score:      ${best.score.toFixed(2)}\n` +
      `  Name match: ${best.nameOverlap.toFixed(2)}\n` +
      `  Addr match: ${best.addressOverlap.toFixed(2)}\n` +
      `  Nbr match:  ${best.neighborhoodOverlap.toFixed(2)}\n` +
      `  Status:     ${best.businessStatus || "(none)"}\n` +
      `  Type:       ${best.primaryType || "(none)"}`
  );

  return true;
}

async function main() {
  if (!API_KEY) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY in environment.");
  }

  const catalog = await readCatalog();
  printCatalogSummary(catalog);

  const candidates = catalog.filter((x) => x.shouldProcess);
  if (!candidates.length) return;

  const proceed = await askToContinue(candidates.length);
  if (!proceed) {
    console.log("Aborted. No API calls were made.");
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const item of candidates) {
    try {
      const ok = await enrichOne(item);
      if (ok) updated += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`\n[ERROR] ${item.basename} :: ${err.message}`);
    }
  }

  console.log("");
  console.log("=== Done ===");
  console.log(`Updated files: ${updated}`);
  console.log(`Failed / skipped for review: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});