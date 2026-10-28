---
name: htmlboard
description: Design UI in plain HTML files and show them side by side on an infinite, live-reloading canvas with the htmlboard CLI. Use when the user asks for mockups, screens, design variants or explorations, components, flyers or any visual proposal, or mentions htmlboard, artboards or designs.json.
---

# HtmlBoard

HtmlBoard serves a folder of HTML files as artboards on a zoomable canvas, like a Figma page. Every design is one ordinary HTML file, so you design by writing HTML and CSS, and the user sees the result update live while you work.

## Start the canvas

Run it in the background, pointed at the designs folder (it is created if missing):

```sh
npx htmlboard designs --open
```

- It prints the URL (default `http://localhost:3000`; if the port is busy it takes the next free one). Give the URL to the user.
- `-p <port>` picks the port. `--init` adds three sample artboards and a `designs.json`; skip it unless the user wants a starter.
- If the artboards link to files above the designs folder (`../css/theme.css`), serve from the project root: `npx htmlboard design --root .`
- An empty folder gets the samples automatically, so write your first artboard before starting the server.
- If a server is already running for this folder, reuse it. `GET /api/health` answers `{"status":"ok","dir":…}`.

## Write an artboard

One design per file. Keep each file self-contained so it renders on its own:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Checkout · variant B</title>   <!-- the artboard's title on the canvas -->
  <style>
    body { margin: 0; }
    .screen { width: 390px; min-height: 844px; /* … */ }
  </style>
</head>
<body>
  <main class="screen">…</main>
</body>
</html>
```

- Design at the real size of the target: phone 390×844, tablet 768×1024, desktop 1280×800 (or 1440×900), and the exact size for print or social formats (e.g. 1080×1350).
- Use real content in the user's language, not lorem ipsum.
- Relative links to shared CSS, images, scripts and fonts work (`assets/logo.svg`; `../css/theme.css` with `--root`). Reuse the project's own stylesheet and tokens when there is one.
- No build step: plain HTML, CSS and browser JavaScript (ES modules and CDN scripts work).

## How the canvas lays out files

**Without `designs.json`** (zero config), every `.html` under the folder is an artboard:

- Each subfolder is a section (row); files at the top level go to "Root Designs".
- The size comes from words in the file's path: `mobile`, `phone`, `iphone` → 390×844; `tablet`, `ipad` → 768×1024; `component`, `ui`, `atomic` → 720×600; `desktop`, `laptop`, `screen` → 1280×800; anything else → 1200×800. Name files accordingly, e.g. `checkout/mobile-variant-b.html`.
- Hidden folders, `node_modules`, `dist` and `build` are skipped.

**With `designs.json`** in the designs folder, the manifest replaces discovery completely: a file not listed in it doesn't show. Use it to choose order, sizes and grouping:

```json
{
  "title": "Checkout redesign",
  "sections": [
    {
      "title": "Checkout · mobile",
      "description": "Three directions for the payment step",
      "designs": [
        { "file": "checkout/a.html", "title": "A · current", "width": 390, "height": 844 },
        { "file": "checkout/b.html", "title": "B · one page", "width": 390, "tags": ["proposal"] },
        { "file": "checkout/b.html?theme=dark", "title": "B · dark", "width": 390, "height": 844 }
      ]
    }
  ]
}
```

- Sections are rows, top to bottom; designs run left to right.
- `file` is relative to the designs folder and may carry a query string, so one file can show several states.
- Omit `height` to let the frame grow to the page's full height (long pages, boards, docs).
- Optional: `description` (shown in the list), `tags` (searchable), `id` (derived from `file`), and `category`, which drives the explorer's filters: `mobile`, `tablet`, `desktop`, `components` or your own word. Left out, it comes from words in the path, then from the size when it is a screen's; flyers, boards and other formats get none.
- `name` and `artboards` are accepted as synonyms of a section's `title` and `designs`.

When the project already has a `designs.json`, add every new file to it.

## Live reload

- Saving an artboard's HTML reloads just that frame; the user's view stays put.
- Saving a file artboards use (a stylesheet, a script, an image, data) reloads the artboards that loaded it.
- Saving `designs.json`, or adding or removing artboards, rebuilds the canvas.

## Working with the user

- Put variants in separate files next to each other (`hero-a.html`, `hero-b.html`) instead of overwriting the current design, so they can be compared on the canvas. Keep the current one as the reference until the user picks.
- Say which files you created or changed and what to look at; the user is watching the canvas, not the code. Link straight to an artboard with `http://localhost:3000/#<id>` (the id is the file's path without `.html`, slashes and other symbols turned into `-`: `checkout/b.html` → `checkout-b`).
- If you can browse or take screenshots, open the artboard directly (`http://localhost:3000/<file>`) to check it at its real size before reporting back. Fix overflow, clipped text and broken images first.
