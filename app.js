(function () {
  const $ = (sel) => document.querySelector(sel);

  function getQuery() {
    try {
      const raw = sessionStorage.getItem("lo_query");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setQuery(q) {
    sessionStorage.setItem("lo_query", JSON.stringify(q));
  }

  function cleanText(value) {
    return (value || "")
      .toString()
      .trim()
      .replace(/\s+/g, " ");
  }

  function normFacet(value) {
    return cleanText(value).toLowerCase();
  }

  function arrifyStrings(value) {
    if (Array.isArray(value)) {
      return value
        .flatMap((v) => arrifyStrings(v))
        .map(cleanText)
        .filter(Boolean);
    }

    if (typeof value === "string") {
      const s = cleanText(value);
      if (!s) return [];

      // Supports either a single string or a delimited list.
      if (/[|;,]/.test(s)) {
        return s
          .split(/\s*[|;,]\s*/)
          .map(cleanText)
          .filter(Boolean);
      }

      return [s];
    }

    return [];
  }

  function tokenize(s) {
    return cleanText(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  function priceNum(p) {
    if (p === "$") return 1;
    if (p === "$$") return 2;
    if (p === "$$$") return 3;
    return 2;
  }

  function score(item, q) {
    const cat = tokenize(q.category);
    const area = tokenize(q.neighborhood);
    const vibe = tokenize(q.vibe);
    const bestFor = tokenize(q.bestFor);

    const hay = [
      item.name,
      item.category,
      item.neighborhood,
      (item.tags || []).join(" "),
      (item.best_for || []).join(" "),
      (item.top_dishes || []).join(" "),
      item.why || "",
    ].join(" ");

    const set = new Set(tokenize(hay));
    let s = 0;

    for (const t of cat) if (set.has(t)) s += 6;
    for (const t of area) if (set.has(t)) s += 5;
    for (const t of vibe) if (set.has(t)) s += 2;
    for (const t of bestFor) if (set.has(t)) s += 4;

    s += (Number(item.rating || 4.5) - 4.0) * 2;
    return s;
  }

  // ---------- Distance + origin helpers ----------

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.7613;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function parseLatLng(text) {
    const s = cleanText(text);
    const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;

    const lat = Number(m[1]);
    const lng = Number(m[2]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
  }

  function normPlace(s) {
    return cleanText(s).toLowerCase();
  }

  function displayPlace(s) {
    return cleanText(s);
  }

  function datasetCentroid(list) {
    let n = 0;
    let latSum = 0;
    let lngSum = 0;

    for (const it of list) {
      const c = it.coordinates;
      const lat = c && Number(c.lat);
      const lng = c && Number(c.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        latSum += lat;
        lngSum += lng;
        n += 1;
      }
    }

    if (!n) return { lat: 36.1627, lng: -86.7816 };
    return { lat: latSum / n, lng: lngSum / n };
  }

  function originFromTypedNeighborhood(list, typed) {
    const t = normPlace(typed);
    if (!t) return null;

    const parsed = parseLatLng(t);
    if (parsed) return parsed;

    const hits = list.filter((x) => normPlace(x.neighborhood) === t);
    if (!hits.length) return null;

    let latSum = 0;
    let lngSum = 0;
    let n = 0;

    for (const it of hits) {
      const c = it.coordinates;
      const lat = c && Number(c.lat);
      const lng = c && Number(c.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        latSum += lat;
        lngSum += lng;
        n += 1;
      }
    }

    if (!n) return null;
    return { lat: latSum / n, lng: lngSum / n };
  }

  function geolocateOnce(timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("no_geolocation"));

      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error("geo_timeout"));
      }, timeoutMs);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err || new Error("geo_error"));
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 }
      );
    });
  }

  async function resolveOrigin(list, q) {
    try {
      const geo = await geolocateOnce(2000);
      return { ...geo, label: "your location", source: "geolocation" };
    } catch {}

    const typed = (q && q.neighborhood) || "";
    const fromTyped = originFromTypedNeighborhood(list, typed);
    if (fromTyped) {
      const label = parseLatLng(typed)
        ? `(${fromTyped.lat.toFixed(4)}, ${fromTyped.lng.toFixed(4)})`
        : typed;
      return { ...fromTyped, label, source: "typed" };
    }

    const cent = datasetCentroid(list);
    return { ...cent, label: "Nashville (default)", source: "dataset_centroid" };
  }

  function parseDistanceCap(q) {
    const raw = (q && q.distance) || "5";
    if (raw === "any") return Infinity;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  // ---------- Landing / forms ----------

  function saveWaitlist(email, city) {
    const key = "lo_waitlist";
    let arr = [];
    try {
      arr = JSON.parse(localStorage.getItem(key) || "[]");
    } catch {}
    arr.push({ email, city, ts: Date.now() });
    localStorage.setItem(key, JSON.stringify(arr));
  }

  function setSelectValueNormalized(select, target, fallback = "") {
    if (!select) return;

    const key = normFacet(target);
    if (!key) {
      select.value = fallback;
      return;
    }

    const opt = Array.from(select.options).find(
      (o) => normFacet(o.value) === key
    );
    select.value = opt ? opt.value : fallback;
  }

  function wireLanding() {
    populateNeighborhoodDropdown();
    populateBestForSearchDropdown();
    wireVibeAutocomplete();

    const searchForm = $("#searchForm");
    if (searchForm) {
      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(searchForm);

        setQuery({
          category: cleanText(fd.get("category")),
          neighborhood: displayPlace(fd.get("neighborhood")),
          vibe: cleanText(fd.get("vibe")),
          bestFor: cleanText(fd.get("bestFor")),
          distance: cleanText(fd.get("distance") || "5"),
        });

        window.location.href = "./results.html";
      });
    }

    const waitlistForm = $("#waitlistForm");
    const waitlistMsg = $("#waitlistMsg");
    if (waitlistForm && waitlistMsg) {
      waitlistForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(waitlistForm);
        const email = cleanText(fd.get("email"));
        const city = cleanText(fd.get("city"));
        saveWaitlist(email, city);
        waitlistMsg.textContent = `Subscribed for weekly picks in ${city}.`;
      });
    }

    const recommendForm = $("#recommendForm");
    const recommendMsg = $("#recommendMsg");
    if (recommendForm && recommendMsg) {
      recommendForm.addEventListener("submit", (e) => {
        e.preventDefault();
        recommendMsg.textContent = "Saved (local only, demo).";
      });
    }
  }

  // ---------- Data normalization ----------

  function getListings() {
    const rawData = Array.isArray(window.LOCALSONLY_DATA)
      ? window.LOCALSONLY_DATA
      : [];
    const rawByName = new Map(rawData.map((x) => [normPlace(x.name), x]));

    if (Array.isArray(window.LISTINGS) && window.LISTINGS.length) {
      return window.LISTINGS.map((x) => {
        const raw = rawByName.get(normPlace(x.name)) || {};

        const mergedTags =
          arrifyStrings(x.tags).length ? arrifyStrings(x.tags) : arrifyStrings(raw.tags);

        const mergedBestFor =
          arrifyStrings(x.best_for).length
            ? arrifyStrings(x.best_for)
            : arrifyStrings(raw.best_for);

        const mergedTopDishes =
          arrifyStrings(x.top_dishes).length
            ? arrifyStrings(x.top_dishes)
            : arrifyStrings(raw.top_dishes);

        return {
          ...x,
          neighborhood:
            x.neighborhood ||
            (raw.neighborhoods && raw.neighborhoods[0]) ||
            (raw.location && raw.location.neighborhood) ||
            "",
          open_now:
            x.open_now ??
            x.openNow ??
            raw.open_now ??
            raw.openNow ??
            null,
          why: x.why || raw.why || raw.recommendation || "",
          tags: mergedTags,
          best_for: mergedBestFor,
          top_dishes: mergedTopDishes,
          coordinates: x.coordinates || raw.coordinates || null,
          hours: x.hours ?? raw.hours ?? null,
          timezone: x.timezone || raw.timezone || null,
        };
      });
    }

    if (rawData.length) {
      return rawData.map((x) => ({
        name: x.name,
        category: x.category,
        neighborhood:
          (x.neighborhoods && x.neighborhoods[0]) ||
          (x.location && x.location.neighborhood) ||
          "",
        price: x.price,
        rating: x.rating,
        open_now: x.openNow ?? x.open_now ?? null,
        why: x.why || x.recommendation || "",
        tags: arrifyStrings(x.tags),
        best_for: arrifyStrings(x.best_for),
        top_dishes: arrifyStrings(x.top_dishes),
        coordinates: x.coordinates,
        hours: x.hours ?? null,
        timezone: x.timezone || null,
      }));
    }

    return [];
  }

  // ---------- Facet catalog helpers ----------

  function buildFacetCatalog(items, getter) {
    const seen = new Map();

    for (const item of items) {
      const values = arrifyStrings(getter(item));
      for (const raw of values) {
        const key = normFacet(raw);
        const label = cleanText(raw);
        if (!key || !label) continue;

        if (!seen.has(key)) {
          seen.set(key, { value: label, label, count: 0 });
        }
        seen.get(key).count += 1;
      }
    }

    return Array.from(seen.values()).sort((a, b) => {
      return b.count - a.count || a.label.localeCompare(b.label, undefined, {
        sensitivity: "base",
      });
    });
  }

  function getTagCatalog() {
    return buildFacetCatalog(getListings(), (item) => item.tags);
  }

  function getBestForCatalog() {
    return buildFacetCatalog(getListings(), (item) => item.best_for);
  }

  // ---------- Neighborhood dropdown ----------

  function extractNeighborhoods(item) {
    if (!item || typeof item !== "object") return [];

    if (Array.isArray(item.neighborhoods) && item.neighborhoods.length) {
      return item.neighborhoods;
    }

    if (item.location && item.location.neighborhood) {
      return [item.location.neighborhood];
    }

    if (item.neighborhood) {
      return [item.neighborhood];
    }

    return [];
  }

  function getNeighborhoodOptions() {
    const rawData = Array.isArray(window.LOCALSONLY_DATA)
      ? window.LOCALSONLY_DATA
      : [];
    const source = rawData.length ? rawData : getListings();

    const seen = new Map();

    for (const item of source) {
      const neighborhoods = extractNeighborhoods(item);

      for (const raw of neighborhoods) {
        const display = displayPlace(raw);
        const key = normPlace(raw);

        if (!key) continue;
        if (!seen.has(key)) {
          seen.set(key, display);
        }
      }
    }

    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  function populateNeighborhoodDropdown() {
    const select = $("#neighborhoodSelect");
    if (!select) return;

    const options = getNeighborhoodOptions();

    select.innerHTML = `<option value="" disabled selected>Select a neighborhood</option>`;

    for (const neighborhood of options) {
      const opt = document.createElement("option");
      opt.value = neighborhood;
      opt.textContent = neighborhood;
      select.appendChild(opt);
    }
  }

  // ---------- Best-for dropdowns ----------

  function populateBestForSearchDropdown() {
    const select = $("#bestForSearch");
    if (!select) return;

    const options = getBestForCatalog();

    select.innerHTML = `<option value="" selected>For</option>`;

    for (const item of options) {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      select.appendChild(opt);
    }
  }

  function populateBestForFilterDropdown(defaultValue) {
    const select = $("#bestForSelect");
    if (!select) return;

    const options = getBestForCatalog();
    select.innerHTML = `<option value="any">Any</option>`;

    for (const item of options) {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      select.appendChild(opt);
    }

    setSelectValueNormalized(select, defaultValue || "any", "any");
  }

  // ---------- Landing-page vibe autocomplete ----------

  function wireVibeAutocomplete() {
    const input = $("#vibeInput");
    const menu = $("#vibeSuggestions");

    if (!input || !menu) return;

    const catalog = getTagCatalog();
    let visible = [];
    let activeIndex = -1;

    function getSuggestions(term) {
      const q = normFacet(term);

      if (!q) {
        return catalog.slice(0, 8);
      }

      return catalog
        .filter((item) => normFacet(item.label).includes(q))
        .sort((a, b) => {
          const aStarts = normFacet(a.label).startsWith(q) ? 0 : 1;
          const bStarts = normFacet(b.label).startsWith(q) ? 0 : 1;
          return (
            aStarts - bStarts ||
            b.count - a.count ||
            a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
          );
        })
        .slice(0, 8);
    }

    function closeMenu() {
      menu.hidden = true;
      menu.innerHTML = "";
      visible = [];
      activeIndex = -1;
    }

    function renderMenu(term) {
      visible = getSuggestions(term);
      activeIndex = -1;

      if (!visible.length) {
        closeMenu();
        return;
      }

      menu.innerHTML = visible
        .map(
          (item, index) => `
            <button
              type="button"
              class="autocomplete-item"
              data-index="${index}"
              data-value="${item.value.replace(/"/g, "&quot;")}"
            >
              <span>${item.label}</span>
            </button>
          `
        )
        .join("");

      menu.hidden = false;
    }

    function syncActiveItem() {
      const nodes = menu.querySelectorAll(".autocomplete-item");
      nodes.forEach((node, index) => {
        node.classList.toggle("is-active", index === activeIndex);
      });
    }

    function choose(value) {
      input.value = value;
      closeMenu();
      input.focus();
    }

    input.addEventListener("focus", () => {
      renderMenu(input.value);
    });

    input.addEventListener("input", () => {
      renderMenu(input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (menu.hidden || !visible.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % visible.length;
        syncActiveItem();
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + visible.length) % visible.length;
        syncActiveItem();
        return;
      }

      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        choose(visible[activeIndex].value);
        return;
      }

      if (e.key === "Escape") {
        closeMenu();
      }
    });

    menu.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-value]");
      if (!btn) return;
      choose(btn.dataset.value);
    });

    document.addEventListener("click", (e) => {
      if (e.target === input) return;
      if (menu.contains(e.target)) return;
      closeMenu();
    });
  }

  // ---------- Hours helpers ----------

  const DEFAULT_RECOMMENDATION_TIMEZONE = "America/Chicago";
  const DAY_KEYS = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const DAY_LABELS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  function canonicalDayKey(value) {
    const s = cleanText(value).toLowerCase();
    const map = {
      sun: "sunday",
      sunday: "sunday",
      mon: "monday",
      monday: "monday",
      tue: "tuesday",
      tues: "tuesday",
      tuesday: "tuesday",
      wed: "wednesday",
      weds: "wednesday",
      wednesday: "wednesday",
      thu: "thursday",
      thur: "thursday",
      thurs: "thursday",
      thursday: "thursday",
      fri: "friday",
      friday: "friday",
      sat: "saturday",
      saturday: "saturday",
    };
    return map[s] || null;
  }

  function parseClockToMinutes(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.min(1439, Math.floor(value)));
    }

    const s = cleanText(value).toLowerCase();
    if (!s) return null;

    if (s === "noon") return 12 * 60;
    if (s === "midnight") return 0;

    let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (m) {
      let hour = Number(m[1]);
      const minute = Number(m[2] || "0");
      const ampm = m[3].toLowerCase();

      if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
      if (hour === 12) hour = 0;
      if (ampm === "pm") hour += 12;
      return hour * 60 + minute;
    }

    m = s.match(/^(\d{1,2})(?::(\d{2}))$/);
    if (m) {
      const hour = Number(m[1]);
      const minute = Number(m[2] || "0");
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      return hour * 60 + minute;
    }

    return null;
  }

  function formatMinutes(minutes) {
    const safe = ((Number(minutes) % 1440) + 1440) % 1440;
    const hour24 = Math.floor(safe / 60);
    const minute = safe % 60;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;
    return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
  }

  function normalizeInterval(entry) {
    if (entry == null) return null;

    if (typeof entry === "string") {
      const s = entry.trim();
      if (!s || /^closed$/i.test(s)) return null;
      const parts = s.split(/\s*[–—-]\s*/);
      if (parts.length !== 2) return null;

      const openMin = parseClockToMinutes(parts[0]);
      const closeMin = parseClockToMinutes(parts[1]);
      if (openMin == null || closeMin == null) return null;

      return { openMin, closeMin };
    }

    if (typeof entry === "object" && !Array.isArray(entry)) {
      const openRaw = entry.open ?? entry.start;
      const closeRaw = entry.close ?? entry.end;
      const openMin = parseClockToMinutes(openRaw);
      const closeMin = parseClockToMinutes(closeRaw);
      if (openMin == null || closeMin == null) return null;

      return { openMin, closeMin };
    }

    return null;
  }

  function getHoursValueForDay(hours, dayKey) {
    if (!hours || typeof hours !== "object") return null;

    for (const [rawKey, rawValue] of Object.entries(hours)) {
      if (canonicalDayKey(rawKey) === dayKey) {
        return rawValue;
      }
    }

    return null;
  }

  function getIntervalsForDay(hours, dayKey) {
    const raw = getHoursValueForDay(hours, dayKey);
    if (raw == null) return [];

    if (typeof raw === "string" && /^closed$/i.test(raw.trim())) {
      return [];
    }

    const arr = Array.isArray(raw) ? raw : [raw];

    return arr
      .map(normalizeInterval)
      .filter(Boolean)
      .sort((a, b) => a.openMin - b.openMin);
  }

  function getNowPartsInTimeZone(timeZone) {
    const tz = timeZone || DEFAULT_RECOMMENDATION_TIMEZONE;

    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });

      const parts = fmt.formatToParts(new Date());
      const map = {};
      for (const p of parts) {
        if (p.type !== "literal") map[p.type] = p.value;
      }

      const dayKey = canonicalDayKey(map.weekday) || "monday";
      const dayIndex = DAY_KEYS.indexOf(dayKey);
      const minutes = Number(map.hour) * 60 + Number(map.minute);

      return { dayKey, dayIndex, minutes };
    } catch {
      const now = new Date();
      return {
        dayKey: DAY_KEYS[now.getDay()],
        dayIndex: now.getDay(),
        minutes: now.getHours() * 60 + now.getMinutes(),
      };
    }
  }

  function getBusinessHoursState(hours, timezone, fallbackOpenNow = null) {
    if (!hours || typeof hours !== "object") {
      if (fallbackOpenNow === true) {
        return {
          isOpenNow: true,
          badgeText: "Open",
          statusText: "Open until later today",
        };
      }

      if (fallbackOpenNow === false) {
        return {
          isOpenNow: false,
          badgeText: "Closed",
          statusText: "Closed until later",
        };
      }

      return {
        isOpenNow: false,
        badgeText: "Hours",
        statusText: "Hours unavailable",
      };
    }

    const now = getNowPartsInTimeZone(timezone);
    const todayKey = DAY_KEYS[now.dayIndex];
    const prevKey = DAY_KEYS[(now.dayIndex + 6) % 7];

    const prevIntervals = getIntervalsForDay(hours, prevKey);
    for (const interval of prevIntervals) {
      const isOvernight = interval.closeMin <= interval.openMin;
      if (isOvernight && now.minutes < interval.closeMin) {
        return {
          isOpenNow: true,
          badgeText: "Open",
          statusText: `Open until ${formatMinutes(interval.closeMin)}`,
        };
      }
    }

    const todayIntervals = getIntervalsForDay(hours, todayKey);
    let nextOpenToday = null;

    for (const interval of todayIntervals) {
      const isOvernight = interval.closeMin <= interval.openMin;

      if (!isOvernight) {
        if (now.minutes >= interval.openMin && now.minutes < interval.closeMin) {
          return {
            isOpenNow: true,
            badgeText: "Open",
            statusText: `Open until ${formatMinutes(interval.closeMin)}`,
          };
        }

        if (now.minutes < interval.openMin) {
          nextOpenToday =
            nextOpenToday == null
              ? interval.openMin
              : Math.min(nextOpenToday, interval.openMin);
        }
      } else {
        if (now.minutes >= interval.openMin) {
          return {
            isOpenNow: true,
            badgeText: "Open",
            statusText: `Open until ${formatMinutes(interval.closeMin)}`,
          };
        }

        if (now.minutes < interval.openMin) {
          nextOpenToday =
            nextOpenToday == null
              ? interval.openMin
              : Math.min(nextOpenToday, interval.openMin);
        }
      }
    }

    if (nextOpenToday != null) {
      return {
        isOpenNow: false,
        badgeText: "Closed",
        statusText: `Closed until ${formatMinutes(nextOpenToday)}`,
      };
    }

    for (let offset = 1; offset <= 7; offset += 1) {
      const idx = (now.dayIndex + offset) % 7;
      const dayKey = DAY_KEYS[idx];
      const intervals = getIntervalsForDay(hours, dayKey);

      if (intervals.length) {
        const first = intervals[0];
        const label = offset === 1 ? "Tomorrow" : DAY_LABELS[idx];
        return {
          isOpenNow: false,
          badgeText: "Closed",
          statusText: `Open ${label} at ${formatMinutes(first.openMin)}`,
        };
      }
    }

    return {
      isOpenNow: false,
      badgeText: "Closed",
      statusText: "Closed",
    };
  }

  // ---------- Results helpers ----------

  function matchesFacetList(values, selectedValue) {
    const target = normFacet(selectedValue);
    if (!target || target === "any") return true;

    return arrifyStrings(values).some((v) => normFacet(v) === target);
  }

  function escapeHtml(value) {
    return cleanText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- Results ----------

  async function wireResults() {
    const cardsEl = $("#cards");
    if (!cardsEl) return;

    const q =
      getQuery() || {
        category: "",
        neighborhood: "Nashville",
        vibe: "",
        bestFor: "",
        distance: "5",
      };

    const summaryText = $("#summaryText");
    const countText = $("#countText");

    const base = getListings();
    populateBestForFilterDropdown(q.bestFor);

    const origin = await resolveOrigin(base, q);
    const maxMi = parseDistanceCap(q);

    if (summaryText) {
      const bits = [
        q.category ? q.category : "Anything",
        q.neighborhood ? q.neighborhood : "Nashville",
        q.bestFor ? `for: ${q.bestFor}` : "",
        q.vibe ? `feeling: ${q.vibe}` : "",
        maxMi === Infinity ? "any distance" : `within ${maxMi} mi`,
      ].filter(Boolean);
      summaryText.textContent = bits.join(" • ");
    }

    const all = base.map((x) => {
      const c = x.coordinates;
      const lat = c && Number(c.lat);
      const lng = c && Number(c.lng);
      const dist =
        Number.isFinite(lat) && Number.isFinite(lng)
          ? haversineMiles(origin.lat, origin.lng, lat, lng)
          : Infinity;

      const openInfo = getBusinessHoursState(
        x.hours,
        x.timezone || DEFAULT_RECOMMENDATION_TIMEZONE,
        x.open_now
      );

      return {
        ...x,
        open_now: openInfo.isOpenNow,
        _openInfo: openInfo,
        _match: score(x, q),
        _priceN: priceNum(x.price),
        _distMi: dist,
      };
    });

    const sortSelect = $("#sortSelect");
    const priceSelect = $("#priceSelect");
    const openSelect = $("#openSelect");
    const bestForSelect = $("#bestForSelect");
    const searchBox = $("#searchBox");
    const resetBtn = $("#resetBtn");
    const showMoreBtn = $("#showMoreBtn");

    let limit = 10;

    function render() {
      const sortBy = sortSelect ? sortSelect.value : "match";
      const price = priceSelect ? priceSelect.value : "any";
      const open = openSelect ? openSelect.value : "any";
      const bestForValue = bestForSelect ? bestForSelect.value : q.bestFor || "any";
      const term = cleanText(searchBox ? searchBox.value : "").toLowerCase();

      let list = all.slice();

      if (q.category) {
        const catNorm = normPlace(q.category);
        list = list.filter((x) => normPlace(x.category) === catNorm);
      }

      if (q.bestFor) {
        list = list.filter((x) => matchesFacetList(x.best_for, q.bestFor));
      }

      if (price !== "any") list = list.filter((x) => x.price === price);
      if (open === "open") list = list.filter((x) => x.open_now === true);

      if (bestForValue !== "any") {
        list = list.filter((x) => matchesFacetList(x.best_for, bestForValue));
      }

      if (term) {
        list = list.filter((x) => {
          const hay = [
            x.name,
            x.category,
            x.neighborhood,
            (x.tags || []).join(" "),
            (x.best_for || []).join(" "),
            (x.top_dishes || []).join(" "),
            x.why || "",
          ]
            .join(" ")
            .toLowerCase();

          return hay.includes(term);
        });
      }

      const distanceFiltered = maxMi !== Infinity;
      let filteredByDistance = list;

      if (distanceFiltered) {
        filteredByDistance = list.filter((x) => x._distMi <= maxMi);
      }

      let usedFallback = false;
      if (distanceFiltered && !filteredByDistance.length) {
        usedFallback = true;
        filteredByDistance = list.slice();
      }

      list = filteredByDistance;

      list.sort((a, b) => {
        if (sortBy === "rating") {
          return (b.rating || 0) - (a.rating || 0) || a._distMi - b._distMi;
        }
        if (sortBy === "price") {
          return a._priceN - b._priceN || a._distMi - b._distMi;
        }
        return b._match - a._match || a._distMi - b._distMi;
      });

      const total = list.length;
      const shown = Math.min(limit, total);
      const visible = list.slice(0, shown);

      if (countText) {
        if (usedFallback) {
          countText.textContent = `No results within ${maxMi} mi of ${origin.label}. Showing closest picks instead.`;
        } else if (maxMi === Infinity) {
          countText.textContent = `Showing ${shown} of ${total}`;
        } else {
          countText.textContent = `Showing ${shown} of ${total} (within ${maxMi} mi of ${origin.label})`;
        }
      }

      if (showMoreBtn) {
        showMoreBtn.style.display = shown < total ? "inline-flex" : "none";
      }

      cardsEl.innerHTML = "";

      for (const it of visible) {
        const hoursInfo = it._openInfo || {
          badgeText: "Hours",
          statusText: "Hours unavailable",
        };

        const badgeText = hoursInfo.statusText || hoursInfo.badgeText || "";
        const distText = Number.isFinite(it._distMi)
          ? `${it._distMi.toFixed(1)} mi`
          : "";
        const bestForText = arrifyStrings(it.best_for);
        const topDishesText = arrifyStrings(it.top_dishes);

        const el = document.createElement("div");
        el.className = "card-item";
        el.innerHTML = `
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:24px; width:100%;">
            <div style="flex:1 1 auto; min-width:0;">
              <div class="card-name">${escapeHtml(it.name)}</div>
              <div class="card-meta" style="margin-top:4px;">
                ${escapeHtml(it.category)} • ${escapeHtml(it.neighborhood)} • ${escapeHtml(it.price)} • ${Number(
          it.rating || 0
        ).toFixed(1)}${distText ? " • " + escapeHtml(distText) : ""}
              </div>

              ${
                it.why
                  ? `<div class="card-meta" style="margin-top:12px;">${escapeHtml(
                      it.why
                    )}</div>`
                  : ""
              }

              ${
                topDishesText.length
                  ? `<div class="card-meta card-favorites" style="margin-top:10px;"><strong>Favorites:</strong> ${escapeHtml(
                      topDishesText.join(", ")
                    )}</div>`
                  : ""
              }

              ${
                bestForText.length
                  ? `<div class="card-meta" style="margin-top:8px;"><strong>Best for:</strong> ${escapeHtml(
                      bestForText.join(", ")
                    )}</div>`
                  : ""
              }
            </div>

            <div
              class="badge"
              style="
                margin-left:auto;
                flex:0 0 auto;
                align-self:flex-start;
                white-space:nowrap;
                text-align:center;
                line-height:1.2;
                padding:10px 16px;
              "
            >${escapeHtml(badgeText)}</div>
          </div>
        `;
        cardsEl.appendChild(el);
      }
    }

    function resetAndRender() {
      limit = 10;
      render();
    }

    if (sortSelect) sortSelect.addEventListener("change", resetAndRender);
    if (priceSelect) priceSelect.addEventListener("change", resetAndRender);
    if (openSelect) openSelect.addEventListener("change", resetAndRender);
    if (bestForSelect) bestForSelect.addEventListener("change", resetAndRender);
    if (searchBox) searchBox.addEventListener("input", resetAndRender);

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (sortSelect) sortSelect.value = "match";
        if (priceSelect) priceSelect.value = "any";
        if (openSelect) openSelect.value = "any";
        if (bestForSelect) setSelectValueNormalized(bestForSelect, q.bestFor || "any", "any");
        if (searchBox) searchBox.value = "";
        limit = 10;
        render();
      });
    }

    if (showMoreBtn) {
      showMoreBtn.addEventListener("click", () => {
        limit += 10;
        render();
      });
    }

    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireLanding();
    wireResults();
  });
})();