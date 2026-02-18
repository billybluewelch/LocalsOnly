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

  function tokenize(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
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

    const hay = [
      item.name,
      item.category,
      item.neighborhood,
      (item.tags || []).join(" "),
      item.why || "",
    ].join(" ");

    const set = new Set(tokenize(hay));
    let s = 0;

    for (const t of cat) if (set.has(t)) s += 6;
    for (const t of area) if (set.has(t)) s += 5;
    for (const t of vibe) if (set.has(t)) s += 2;

    s += (Number(item.rating || 4.5) - 4.0) * 2;
    return s;
  }

  // ---------- Distance + origin helpers ----------

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.7613; // miles
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Allow user to type "34.0522,-118.2437" as a fallback origin
  function parseLatLng(text) {
    const s = (text || "").toString().trim();
    // matches "lat,lng" or "lat lng"
    const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function normPlace(s) {
    return (s || "").toString().trim().toLowerCase();
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
    if (!n) return { lat: 36.1627, lng: -86.7816 }; // Nashville-ish fallback
    return { lat: latSum / n, lng: lngSum / n };
  }

  // If user types a known neighborhood, use centroid of listings in that neighborhood
  function originFromTypedNeighborhood(list, typed) {
    const t = normPlace(typed);
    if (!t) return null;

    // 1) coordinate string?
    const parsed = parseLatLng(t);
    if (parsed) return parsed;

    // 2) neighborhood centroid match
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
    // 1) geolocation first (works on GitHub Pages + localhost)
    try {
      const geo = await geolocateOnce(2000);
      return { ...geo, label: "your location", source: "geolocation" };
    } catch {}

    // 2) fallback: use what they typed in the index neighborhood field
    const typed = (q && q.neighborhood) || "";
    const fromTyped = originFromTypedNeighborhood(list, typed);
    if (fromTyped) {
      const label = parseLatLng(typed)
        ? `(${fromTyped.lat.toFixed(4)}, ${fromTyped.lng.toFixed(4)})`
        : typed;
      return { ...fromTyped, label, source: "typed" };
    }

    // 3) last resort: dataset centroid (so results still show even if user typed "Los Angeles")
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

  function wireLanding() {
    const searchForm = $("#searchForm");
    if (searchForm) {
      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(searchForm);
        setQuery({
          category: (fd.get("category") || "").toString().trim(),
          neighborhood: (fd.get("neighborhood") || "").toString().trim(),
          vibe: (fd.get("vibe") || "").toString().trim(),
          distance: (fd.get("distance") || "5").toString().trim(),
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
        const email = (fd.get("email") || "").toString().trim();
        const city = (fd.get("city") || "").toString().trim();
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

  function getListings() {
    // Prefer the generated LISTINGS (should include coordinates, etc.)
    if (Array.isArray(window.LISTINGS) && window.LISTINGS.length) return window.LISTINGS;

    // Fallback shape if only LOCALSONLY_DATA exists
    if (Array.isArray(window.LOCALSONLY_DATA) && window.LOCALSONLY_DATA.length) {
      return window.LOCALSONLY_DATA.map((x) => ({
        name: x.name,
        category: x.category,
        neighborhood: (x.neighborhoods && x.neighborhoods[0]) || "",
        price: x.price,
        rating: x.rating,
        open_now: x.openNow, // can be true/false/null
        why: x.why,
        tags: x.tags || [],
        coordinates: x.coordinates,
      }));
    }

    return [];
  }

  // ---------- Results ----------

  async function wireResults() {
    const cardsEl = $("#cards");
    if (!cardsEl) return;

    const q =
      getQuery() || { category: "", neighborhood: "Nashville", vibe: "", distance: "5" };

    const summaryText = $("#summaryText");
    const countText = $("#countText");

    const base = getListings();

    // Resolve origin once, then compute distances
    const origin = await resolveOrigin(base, q);
    const maxMi = parseDistanceCap(q);

    if (summaryText) {
      const bits = [
        q.category ? q.category : "Anything",
        q.neighborhood ? q.neighborhood : "Nashville",
        q.vibe ? `vibe: ${q.vibe}` : "",
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

      return {
        ...x,
        _match: score(x, q),
        _priceN: priceNum(x.price),
        _distMi: dist,
      };
    });

    const sortSelect = $("#sortSelect");
    const priceSelect = $("#priceSelect");
    const openSelect = $("#openSelect");
    const searchBox = $("#searchBox");
    const resetBtn = $("#resetBtn");
    const showMoreBtn = $("#showMoreBtn");

    let limit = 10;

    function render() {
      const sortBy = sortSelect ? sortSelect.value : "match";
      const price = priceSelect ? priceSelect.value : "any";
      const open = openSelect ? openSelect.value : "any";
      const term = (searchBox ? searchBox.value : "").toString().trim().toLowerCase();

      // Start with all, then apply filters.
      let list = all.slice();

      // Strict category filter (matches your requirement: "similar in category")
      if (q.category) {
        const catNorm = normPlace(q.category);
        list = list.filter((x) => normPlace(x.category) === catNorm);
      }

      if (price !== "any") list = list.filter((x) => x.price === price);
      if (open === "open") list = list.filter((x) => x.open_now === true);

      if (term) {
        list = list.filter((x) => {
          const hay = [x.name, x.category, x.neighborhood, (x.tags || []).join(" "), x.why || ""]
            .join(" ")
            .toLowerCase();
          return hay.includes(term);
        });
      }

      // Distance filter (from index.html)
      const distanceFiltered = maxMi !== Infinity;
      let filteredByDistance = list;
      if (distanceFiltered) {
        filteredByDistance = list.filter((x) => x._distMi <= maxMi);
      }

      let usedFallback = false;
      if (distanceFiltered && !filteredByDistance.length) {
        // Important: still show results even if user is in LA and picked "within 5 miles"
        usedFallback = true;
        filteredByDistance = list.slice(); // drop distance constraint but keep other filters
      }

      list = filteredByDistance;

      // Sort: Best match uses distance as tiebreaker (nearer wins)
      list.sort((a, b) => {
        if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0) || (a._distMi - b._distMi);
        if (sortBy === "price") return (a._priceN - b._priceN) || (a._distMi - b._distMi);
        // match
        return (b._match - a._match) || (a._distMi - b._distMi);
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
        const badge =
          it.open_now === true ? "Open" : it.open_now === false ? "Closed" : "Hours unknown";

        const distText = Number.isFinite(it._distMi) ? `${it._distMi.toFixed(1)} mi` : "";

        const el = document.createElement("div");
        el.className = "card-item";
        el.innerHTML = `
          <div class="card-top">
            <div>
              <div class="card-name">${it.name}</div>
              <div class="card-meta">
                ${it.category} • ${it.neighborhood} • ${it.price} • ${Number(it.rating || 0).toFixed(1)}
                ${distText ? " • " + distText : ""}
              </div>
            </div>
            <div class="badge">${badge}</div>
          </div>
          <div class="card-meta" style="margin-top:8px;">${it.why || ""}</div>
          <div class="card-meta" style="margin-top:6px;">${(it.tags || []).join(", ")}</div>
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
    if (searchBox) searchBox.addEventListener("input", resetAndRender);

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (sortSelect) sortSelect.value = "match";
        if (priceSelect) priceSelect.value = "any";
        if (openSelect) openSelect.value = "any";
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
    wireResults(); // async is fine; we don't need to await here
  });
})();
