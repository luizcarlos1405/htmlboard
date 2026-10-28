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
- Paths are served from the folder you passed to htmlboard, so relative links to shared CSS, images and fonts work (`../css/theme.css`, `assets/logo.svg`). Reuse the project's own stylesheet and tokens when there is one.
- No build step: plain HTML, CSS and browser JavaScript (ES modules and CDN scripts work).

## How the canvas lays out files

**Without `designs.json`** (zero config), every `.html` under the folder is an artboard:

- Each subfolder is a section (row); files at the top level go to "Root Designs".
- The size comes from words in the file's path: `mobile`, `phone`, `iphone` → 390×844; `tablet`, `ipad` → 768×1024; `component`, `ui`, `atomic` → 720×600; `desktop`, `laptop`, `screen` → 1280×800; anything else → 1200×800. Name files accordingly, e.g. `checkout/mobile-variant-b.html`.
- Hidden folders, `node_modules`, `dist` and `build` are skipped.

**With `designs.json`** at the folder's root, the manifest replaces discovery completely: a file not listed in it doesn't show. Use it to choose order, sizes and grouping:

```json
{
  "title": "Checkout redesign",
  "sections": [
    {
      "id": "checkout",
      "name": "Checkout · mobile",
      "description": "Three directions for the payment step",
      "artboards": [
        { "id": "checkout-a", "title": "A · current", "file": "checkout/a.html", "width": 390, "height": 844, "category": "mobile" },
        { "id": "checkout-b", "title": "B · one page", "file": "checkout/b.html", "width": 390, "category": "mobile", "tags": ["proposal"] }
      ]
    }
  ]
}
```

- Sections are rows, top to bottom; artboards run left to right.
- `file` is relative to the folder. `id` must be unique.
- Omit `height` to let the frame grow to the page's full height (long pages, boards, docs).
- `category` drives the toolbar filters: `desktop`, `mobile`, `tablet`, `components` (anything else, e.g. `responsive`, only shows under All).
- Optional: `description`, `tags` (both searchable).

When the project already has a `designs.json`, add every new file to it.

## Live reload

- Saving an artboard's HTML reloads just that frame; the user's pan and zoom stay put.
- Saving `designs.json`, or creating a new HTML file, rebuilds the canvas.
- Editing a shared file (a CSS or image used by several artboards) does not reload the frames: tell the user to use the frame's reload button or refresh the page.

## Working with the user

- Put variants in separate files next to each other (`hero-a.html`, `hero-b.html`) instead of overwriting the current design, so they can be compared on the canvas. Keep the current one as the reference until the user picks.
- Say which files you created or changed and what to look at; the user is watching the canvas, not the code.
- If you can browse or take screenshots, open the artboard directly (`http://localhost:3000/<file>`) to check it at its real size before reporting back. Fix overflow, clipped text and broken images first.
