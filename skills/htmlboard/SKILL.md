---
name: htmlboard
description: Design UI in plain HTML files and show them side by side on an infinite, live-reloading canvas with the htmlboard CLI. Use when the user asks for mockups, screens, design variants or explorations, components, flyers or any visual proposal, or mentions htmlboard, artboards or designs.json.
---

# HtmlBoard

HtmlBoard serves a folder of HTML files as artboards on a zoomable canvas, like a Figma page. Every design is one ordinary HTML file that says its own name and size, so you design by writing HTML and CSS, and the user sees the result update live while you work.

## Start the canvas

Run it in the background, pointed at the designs folder (it is created if missing):

```sh
npx htmlboard designs --open
```

- It prints the URL (default `http://localhost:3000`; if the port is busy it takes the next free one). Give the URL to the user.
- `-p <port>` picks the port. `--init` adds sample designs; skip it unless the user wants a starter.
- If the artboards link to files above the designs folder (`../css/theme.css`), serve from the project root: `npx htmlboard design --root .`
- An empty folder gets the samples automatically, so write your first artboard before starting the server.
- If a server is already running for this folder, reuse it. `GET /api/health` answers `{"status":"ok","dir":…}`.

## Write an artboard

One design per file, self-contained so it renders on its own, with its facts in the `<head>`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Checkout · one page</title>                         <!-- its name on the canvas -->
  <meta name="description" content="Address and payment on one screen">
  <meta name="htmlboard" content="width=390, height=844">   <!-- its size -->
  <style>
    body { margin: 0; }
    .screen { width: 390px; height: 844px; /* … */ }
  </style>
</head>
<body>
  <main class="screen">…</main>
</body>
</html>
```

- Always give the `width`: it is the frame's viewport, and the page's CSS needs it. Give the `height` for fixed sizes (a phone screen, a flyer: the frame cuts at it); leave it out for pages that should grow with their content.
- Design at the real size of the target: phone 390×844, tablet 768×1024, desktop 1280×800 (or 1440×900), and the exact size for print or social formats (e.g. 1080×1350).
- Use real content in the user's language, not lorem ipsum.
- Relative links to shared CSS, images, scripts and fonts work (`assets/logo.svg`; `../css/theme.css` with `--root`). Reuse the project's own stylesheet and tokens when there is one.
- No build step: plain HTML, CSS and browser JavaScript (ES modules and CDN scripts work).

More tags, all optional:

- `category=…` in the `htmlboard` tag files the design under the explorer's filters: `mobile`, `tablet`, `desktop`, `components` or your own word. Usually not needed: it comes from words in the path, then from the size when it is a screen's.
- `<meta name="htmlboard:variant" content="?theme=dark · dark">` shows the same file again with that query string, named "<title> · dark". Use it for states the page builds from its URL (themes, empty or error states, data). Add one tag per variant; they follow the file.
- `<meta name="htmlboard:label" content="light">` adds a label to the name of the file's own frame ("Checkout · light"), to tell it from its variants.
- `<meta name="htmlboard" content="skip">` leaves a file out (partials, templates, a page that isn't a design).

## Group and order

- **A folder is a section** (a row on the canvas), named after the folder. Put related designs in a folder: `designs/03-checkout/`.
- **Number prefixes set the order** of files and folders: `01-one-page.html`, `02-steps.html`. They don't show in names or links, so you can renumber freely. Files at the top of the designs folder form a first row without a title.
- New files and folders show up on the canvas by themselves; you don't register them anywhere.

**`designs.json`** is optional. When a project has one (in the designs folder), it curates: sections with titles (accents, capitals, an order across folders), and values that win over the files'. Designs it doesn't list still show after the ones it lists, in their folder's section, unless it says `"unlisted": "hide"`. If the project's designs.json groups designs by hand, add a new design to the right section there:

```json
{
  "sections": [
    { "title": "Checkout · mobile", "designs": ["03-checkout/01-one-page.html", "03-checkout/02-steps.html"] },
    { "title": "Launch flyers", "folder": "04-flyers" }
  ]
}
```

An entry is a file name (its variants follow it), or `{ "file", "title", "width", "height", "category", "description" }` to override the file. `"folder"` brings a whole folder. `npx htmlboard migrate <folder>` moves an old designs.json's sizes, names and variants into the files (`--write` to apply; without it, it only shows the plan).

## Live reload

- Saving an artboard's HTML reloads just that frame; the user's view stays put. A new name or size in its `<head>` updates in place.
- Saving a file artboards use (a stylesheet, a script, an image, data) reloads the artboards that loaded it.
- Adding, removing or moving artboards, or saving `designs.json`, rebuilds the canvas.

## Working with the user

- Put variants in separate files next to each other (`01-hero-a.html`, `02-hero-b.html`) instead of overwriting the current design, so they can be compared on the canvas. Keep the current one as the reference until the user picks.
- Say which files you created or changed and what to look at; the user is watching the canvas, not the code. Link straight to an artboard with `http://localhost:3000/#<id>`: the id is the file's path without prefixes and `.html`, other symbols turned into `-` (`03-checkout/02-steps.html` → `checkout-steps`; a variant adds its query: `checkout-steps-theme-dark`).
- If you can browse or take screenshots, open the artboard directly (`http://localhost:3000/<file>`) to check it at its real size before reporting back. Fix overflow, clipped text and broken images first.
