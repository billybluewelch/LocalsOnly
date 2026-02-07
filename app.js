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

  function saveWaitlist(email, city) {
    const key = "lo_waitlist";
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
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
    if (Array.isArray(window.LISTINGS) && window.LISTINGS.length) return window.LISTINGS;

    if (Array.isArray(window.LOCALSONLY_DATA) && window.LOCALSONLY_DATA.length) {
      return window.LOCALSONLY_DATA.map((x) => ({
        name: x.name,
        category: x.category,
        neighborhood: (x.neighborhoods && x.neighborhoods[0]) || "",
        price: x.price,
        rating: x.rating,
        open_now: !!x.openNow,
        why: x.why,
        tags: x.tags || [],
      }));
    }

    return [];
  }

  function wireResults() {
    const cardsEl = $("#cards");
    if (!cardsEl) return;

    const q = getQuery() || { category: "", neighborhood: "Nashville", vibe: "", distance: "5" };
    const summaryText = $("#summaryText");
    if (summaryText) {
      const bits = [
        q.category ? q.category : "Anything",
        q.neighborhood ? q.neighborhood : "Nashville",
        q.vibe ? `vibe: ${q.vibe}` : "",
      ].filter(Boolean);
      summaryText.textContent = bits.join(" • ");
    }

    const all = getListings().map((x) => ({
      ...x,
      _match: score(x, q),
      _priceN: priceNum(x.price),
    }));

    const sortSelect = $("#sortSelect");
    const priceSelect = $("#priceSelect");
    const openSelect = $("#openSelect");
    const searchBox = $("#searchBox");
    const resetBtn = $("#resetBtn");
    const countText = $("#countText");
    const showMoreBtn = $("#showMoreBtn");

    let limit = 10;

    function render() {
      const sortBy = sortSelect ? sortSelect.value : "match";
      const price = priceSelect ? priceSelect.value : "any";
      const open = openSelect ? openSelect.value : "any";
      const term = (searchBox ? searchBox.value : "").toString().trim().toLowerCase();

      let list = all.slice();

      if (price !== "any") list = list.filter((x) => x.price === price);
      if (open === "open") list = list.filter((x) => x.open_now);

      if (term) {
        list = list.filter((x) => {
          const hay = [x.name, x.category, x.neighborhood, (x.tags || []).join(" ")].join(" ").toLowerCase();
          return hay.includes(term);
        });
      }

      if (!list.length) {
        list = all.slice();
      }

      list.sort((a, b) => {
        if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
        if (sortBy === "price") return (a._priceN - b._priceN) || (b._match - a._match);
        return b._match - a._match;
      });

      const total = list.length;
      const shown = Math.min(limit, total);
      const visible = list.slice(0, shown);

      if (countText) countText.textContent = `Showing ${shown} of ${total}`;

      if (showMoreBtn) {
        showMoreBtn.style.display = shown < total ? "inline-flex" : "none";
      }

      cardsEl.innerHTML = "";
      for (const it of visible) {
        const badge = it.open_now ? "Open" : "Closed";
        const el = document.createElement("div");
        el.className = "card-item";
        el.innerHTML = `
          <div class="card-top">
            <div>
              <div class="card-name">${it.name}</div>
              <div class="card-meta">${it.category} • ${it.neighborhood} • ${it.price} • ${Number(it.rating || 0).toFixed(1)}</div>
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
    wireResults();
  });
})();
