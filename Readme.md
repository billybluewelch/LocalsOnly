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
