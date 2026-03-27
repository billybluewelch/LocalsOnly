# AGENTS.md — LocalsOnly

## Project Overview

Static prototype for a local restaurant/directory recommendations site. Two HTML pages (`index.html`, `results.html`) sharing one CSS file and one JavaScript file (`app.js`). No framework, no build toolchain, no bundler — plain files that load directly in a browser.

Data lives in `data.js`, which is auto-generated from YAML-frontmatter markdown files in `localsonly_markdown/recommendations/`.

---

## Repository Structure

```
index.html              Landing page (search form)
results.html            Results page (filtering, sorting, paging)
styles.css              Shared styles
app.js                  All frontend logic (IIFE, 1225 lines)
data.js                 AUTO-GENERATED — do not edit by hand
scripts/
  build_datajs.mjs                            Markdown → data.js
  enrich_recommendations_from_google.mjs      Google Places enrichment
  standardize_recommendation_frontmatter.mjs  Frontmatter cleanup
localsonly_markdown/recommendations/          Source markdown (22 files)
images/                                       Restaurant photos
```

---

## Build / Run Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (fast-glob, gray-matter) |
| `npm run build:data` | Regenerate `data.js` from markdown files |
| `python3 -m http.server 8000` | Serve locally (run from repo root) |
| `npx serve .` | Alternative local server |
| `npm test` | Placeholder — currently exits with error |

Always use a local server (`localhost:8000`). Opening HTML files via `file://` will break `sessionStorage` and module loading in some browsers.

**There are no tests, linters, or type checkers configured.** If you add any, update this file.

---

## Code Style

### Language & Modules

- **Frontend (`app.js`)**: Plain ES5/ES6 JavaScript wrapped in an IIFE. No modules, no imports. Everything attaches to the global `window` object.
- **Build scripts (`scripts/*.mjs`)**: ES modules via `.mjs` extension. Use `node:fs/promises`, `node:path` prefixed imports for Node builtins.
- No TypeScript. No JSX. No transpilation.

### Naming Conventions

- **Functions**: `camelCase` — `getQuery()`, `cleanText()`, `haversineMiles()`, `parseLatLng()`
- **Data properties from markdown**: `snake_case` — `top_dishes`, `best_for`, `price_range`, `rating_proxy`, `maps_url`, `open_now`, `dining_type`, `dietary_options`
- **Local variables**: `camelCase` — `seen`, `row`, `latSum`
- **Constants**: `UPPER_SNAKE_CASE` — `ROOT`, `INPUT_GLOB`, `OUTPUT_FILE`
- **Selectors**: Use the `$` helper: `const $ = (sel) => document.querySelector(sel)`

### Imports (build scripts only)

Node builtins use the `node:` prefix. Third-party packages are imported by name. No relative import extension needed (`.mjs` resolves naturally).

```js
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import glob from "fast-glob";
```

### Formatting

- 2-space indentation throughout.
- Double quotes for strings.
- Semicolons required.
- Trailing commas in multiline arrays/objects (follow existing style).
- Keep lines under ~100 chars; break long expressions at logical points.

### Error Handling

- Build scripts: throw `new Error(...)` with file context for bad data. Use `process.exit(1)` on fatal errors via a top-level `.catch()`.
- Frontend: `try/catch` around `sessionStorage`/`localStorage` access; return safe defaults on failure (never let storage errors break the page).
- Always include the offending filename in error messages when processing markdown files.

```js
// Build script pattern
throw new Error(`Missing required key "${key}" in ${file}`);

// Frontend storage pattern
try {
  const raw = sessionStorage.getItem("lo_query");
  return raw ? JSON.parse(raw) : null;
} catch {
  return null;
}
```

### DOM & Rendering

- Use the `$` shorthand for `querySelector`. No jQuery.
- Build DOM with `document.createElement` / `innerHTML` assignments.
- `sessionStorage` carries the search query between pages. `localStorage` persists waitlist signups.

---

## Data & Markdown Schema

Each markdown file in `localsonly_markdown/recommendations/` has YAML frontmatter with required and optional fields. Required: `name`, `cuisine`, `location.neighborhood`, `coordinates.lat/lng`, `address`, `maps_url`, `price_range`, `recommendation`, `permalink`, `rating_proxy`. See `README.md` for the full schema.

**`permalink` must be unique** across all files — it becomes the listing `id`.

After editing markdown, always run `npm run build:data` to regenerate `data.js`.

---

## Key Patterns to Follow

- **Small pure functions** over classes or complex state. The existing codebase uses helper functions like `cleanText()`, `tokenize()`, `asStringArray()` that each do one thing.
- **Normalize defensively**: coerce types, dedupe arrays, trim whitespace, provide defaults. See `asStringArray()` and `normalize()` in `build_datajs.mjs`.
- **Sort deterministically**: `rows.sort((a, b) => a.name.localeCompare(b.name))` for data; scored ranking for search results.
- **Auto-generated header**: When writing `data.js`, include the `// AUTO-GENERATED FILE. DO NOT EDIT.` banner.
- **Don't edit `data.js` by hand** — it will be overwritten by `npm run build:data`.

---

## What NOT to Do

- Do not add a bundler, framework, or TypeScript without team discussion.
- Do not change `data.js` directly — edit markdown and rebuild.
- Do not break the IIFE pattern in `app.js` without converting all of it.
- Do not introduce dependencies beyond `fast-glob` and `gray-matter` without checking if they're needed.
- Do not store secrets or API keys in committed files (the Google enrichment script reads from env vars).
