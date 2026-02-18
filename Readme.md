# LocalsOnly (static prototype)

This project is a small static prototype for our local directory and recommendations idea. The point of the prototype is showing our user flow and the UX, rather than shipping production code.

The current version uses plain files that load directly in a browser. The folder contains two pages and a small hardcoded dataset that keeps everything self-contained.

---

## The big picture (what these files are)

Most basic websites are built from three types of files.

- **HTML** files define structure and content on the page.
- **CSS** files define styling, spacing, and overall layout.
- **JavaScript** files define behavior when people click, type, or submit forms.

This prototype uses two HTML pages that share one CSS file and one JavaScript file.

---

## Files in this folder

### `index.html`
This file represents our landing page.

The page centers around one action that collects a category, a neighborhood, and an optional vibe. A form submission saves the entered values and then navigates to our results page.

The lower section includes our weekly picks signup form and our “recommend a spot” form. Those forms currently store values locally in the browser for demo purposes.

### `results.html`
This file represents our results page.

The page reads the values entered on our landing page and loads the listings from `data.js`. The list appears immediately, and our basic filtering and sorting controls change what is shown.

The results list supports a simple paging feel through a “Show more” button. The overall page exists to demonstrate what our browsing experience could look like later.

### `styles.css`
This file holds styling shared by both pages.

The styling aims for a first-pass look that stays readable and consistent. The rules are intentionally limited so our prototype stays easy to change.

### `data.js`
This file holds our dummy dataset.

The file defines `window.LOCALSONLY_DATA` as our raw dummy listings. The file also defines `window.LISTINGS` as a simplified shape used by our UI.

The data is intended to be swapped later with our real listings or an API response.

### `app.js`
This file contains our JavaScript logic for both pages.

On our landing page, the script captures form values, stores them in `sessionStorage`, and then moves the user to our results page. On our results page, the script reads the stored query, computes a simple match score, renders a list, and applies filters, sorting, and search.

A small waitlist demo uses `localStorage` so our signups persist across reloads on the same computer.

---

## About “storage” (where values go right now)

Our prototype uses browser storage in place of a backend.

- **sessionStorage** holds our search query so it can be carried from our landing page to our results page.
- **localStorage** holds our waitlist signups so they persist in the browser until the user clears site data.

This setup keeps our prototype easy to run and easy to share as a folder.

---

## Running it locally

A typical run starts with opening `index.html` in a browser tab. The browser loads `styles.css`, `data.js`, and `app.js` from the same folder. Submitting the main form then routes to `results.html`, which uses the same shared CSS and JavaScript.

---

## Stuff we’ll probably do next

A likely next step involves replacing `data.js` with our real listings. Another likely next step involves sending our waitlist signups to a real place, such as a spreadsheet, Airtable, Supabase, or a small backend endpoint.

Other follow-ons often include richer listing fields like maps links and hours, a favorites feature, and a real submission flow for “recommend a spot.” Matching can also grow from simple keywords into something more personalized once our real user signals exist.

## Benbro (or anyone) quickstart (generate `data.js` + test locally)

Currently we pre-generate data.js using the markdown files. I imagine later on there will be a better way to scale, but this is a simple starting point.

### 1) Clone the latest repo
- Clone the latest version of the project to your machine and `cd` into it.

use a terminal and go into the folder you wish to import this repository into.
Use the command git clone https://github.com/billybluewelch/LocalsOnly.git 


### 2) Add your recommendation markdown files
- Create this folder in the root directory:
  - `./localsonly_markdown/recommendations/`
- Drop your `.md` files into that folder.
- Each file should follow this schema (YAML frontmatter at the top of the markdown):

```yaml
---
# =========================
# REQUIRED (must be present)
# =========================
name: "Display Name"
cuisine: "Category Name"              # ex: Food & Drink, Coffee, Brunch, etc.
location:
  city: "Nashville"
  neighborhood: "Downtown"
coordinates:
  lat: 36.158803
  lng: -86.778281
address: "221 Broadway, Nashville, TN 37201"
maps_url: "https://maps.app.goo.gl/..."
price_range: "$$"                     # $, $$, $$$
recommendation: "One-line why it’s good."
permalink: "unique-stable-id"
rating_proxy: 4.7

# =========================
# OPTIONAL (safe to omit)
# =========================
phone: "(615) 000-0000"
website: "https://..."
dining_type: "casual dining"
dietary_options:
  - "vegan options"
top_dishes:
  - "avocado toast"
best_for:
  - "weekend brunch"
tags:
  - "cozy"
  - "patio"
nearish:
  - "music venues"
image: "../images/example.jpg"

hours_of_operation:
  timezone: "America/Chicago"
  hours:
    monday:    ["08:00-15:00"]
    tuesday:   ["08:00-15:00"]
    wednesday: ["08:00-15:00"]
    thursday:  ["08:00-15:00"]
    friday:    ["08:00-15:00"]
    saturday:  ["09:00-16:00"]
    sunday:    []
---
```

### 3) Install what you need to build
- Install Node.js (LTS recommended).
  - `brew install node`
- From the repo root, install dependencies:
  - `npm install`

### 4) Build `data.js` from the markdown
- Run the build script:
  - `npm run build:data`
- Confirm `data.js` updated (you should see a success message in the terminal).

### 5) Run locally (don’t open the HTML by double-clicking)
- Start a local static server from the repo root (pick one):
  - `python3 -m http.server 8000`
  - or `npx serve .`

### 6) Test the app
- Open in your browser:
  - `http://localhost:8000/index.html` (if using Python on port 8000)
- Submit the form and confirm:
  - you land on `results.html`
  - results appear
  - results change when you change category / neighborhood / distance

### Vital “gotchas” (so you don’t lose time)
- **YAML must be valid** (quotes on strings with special chars, no tabs, consistent indentation).
- **`permalink` must be unique** across all markdown files.

