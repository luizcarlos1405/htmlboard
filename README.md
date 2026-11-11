<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/luizcarlos1405/htmlboard/main/brand/logo-dark.svg">
    <img alt="htmlboard" src="https://raw.githubusercontent.com/luizcarlos1405/htmlboard/main/brand/logo-light.svg" height="56">
  </picture>
</h1>

> **Infinite canvas and design explorer for HTML artboards — designed for humans and LLMs.**

[![npm version](https://img.shields.io/npm/v/htmlboard.svg?style=flat-square&color=3D9DFF)](https://www.npmjs.com/package/htmlboard)
[![license](https://img.shields.io/npm/l/htmlboard.svg?style=flat-square&color=48484D)](LICENSE)
[![node version](https://img.shields.io/node/v/htmlboard.svg?style=flat-square)](https://nodejs.org)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg?style=flat-square)](package.json)

**HtmlBoard** turns any folder of HTML files into a Figma-like interactive infinite canvas. Inspect responsive variants, mobile and desktop layouts, design system components, and full application flows side-by-side with instant live reload.

---

## 💡 Why HtmlBoard?

Modern AI agents and developers generate dozens of HTML mockups, layout variations, and prototypes in seconds. But previewing them has always been awkward:
- **Tabs upon tabs:** Flipping between dozens of browser tabs breaks context and comparison.
- **Figma is locked down:** Exporting code into proprietary design tools is slow and out of sync.
- **Traditional dev servers only show one page:** You lose the holistic bird's-eye view of your product's flow.

**HtmlBoard bridges this gap.** It gives you an infinite 2D canvas for HTML artboards — zero config, zero external dependencies, fast enough and getting faster, and purpose-built for AI-driven frontend prototyping.

---

## ✨ Features

- 🛸 **Infinite Canvas**: Drag or scroll to move, <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + scroll or pinch to zoom (2% to 800%), with a mouse, a trackpad or a touch screen. Names and section titles stay sharp at any zoom, and the dot grid keeps its spacing.
- ⚡ **Zero Dependencies**: Pure native Node.js ES modules, fonts included. Runs instantly with `npx htmlboard`, offline too.
- 🔄 **State-Preserving Live Reload**: The server watches the project and pushes every save (Server-Sent Events). Saving a design reloads its frame; saving a file designs use (a stylesheet, a component, a script, an image, data) reloads just the designs that loaded it; new, removed and renamed designs show up by themselves. Your view never moves.
- 📂 **Designs That Describe Themselves**: Every HTML file is a design, each folder a section, number prefixes the order. A file says its own size, category and variants in a `<meta>` tag or two, so adding a design means writing one file — nothing to keep in sync.
- 🧩 **Components**: Each file in `components/` is a custom element named after it (`tx-item.html` is `<tx-item>`), so the sidebar every screen shares is written once and used as one tag: attributes, slots and scoped CSS, built in the light DOM with your `styles.css`, no build step.
- 🗂️ **A Catalog for Agents**: `htmlboard catalog` reads the project and prints what the designs share in a few lines: each stylesheet's variables and classes, the scripts, every component with its attributes, an example and where it's used. An agent learns your styles and components without reading every file, and since it's read from the files, it is never out of date.
- 🩺 **Checks for Agents**: `htmlboard check` has the canvas load each design again in a browser (yours, or one out of sight) and report, as text, what went wrong: script errors, missing files and components, fonts that didn't load, content cut at the frame's edge, text cut off or spilling out of its box. An agent checks its work without screenshots.
- 📷 **Shots for Agents**: `htmlboard shot` saves a design, or one element of it, as a PNG and prints where, so an agent can look at what it made without a screenshot tool of its own. A part, or a smaller image, costs it fewer tokens.
- 📐 **Optional `designs.json`**: Curates when you want it (section titles, order, overrides); designs it doesn't list still show at the end, or don't (`"unlisted": "hide"`). `htmlboard migrate` moves an existing one into the files.
- 📱 **Device Filters**: **Mobile**, **Tablet** and **Desktop** (and **Components**, or your own categories) lay out just those designs, side by side, to compare them.
- 🔎 **Search**: Find designs by name, file, tags or section (case and accents don't matter); the others fade out in place.
- 👁️ **Sections You Can Fold and Hide**: Fold a section in the list, or hide it from the canvas: its designs unload, so a canvas of hundreds of designs stays light. <kbd>Alt</kbd> + click its eye to see only that one; the list remembers what you folded and hid.
- 🖼️ **Light When Zoomed Out**: Below 25%, each design shows as a picture of its page, made in the background, and the page under it isn't drawn: hundreds of designs pan and zoom smoothly, and their animations don't keep your computer busy. Zoom in and they're live again.
- 🌗 **Themes Without Variants**: One switch in the toolbar (<kbd>T</kbd>) shows every design in a theme the project has, found in its stylesheets (`[data-theme="dark"]` rules, or the system's light and dark) or named in `designs.json`. `htmlboard check --themes all` checks each design in each theme, and `htmlboard shot --theme dark` looks at one.
- 📸 **Copy or Save as an Image**: Hover a design for two buttons: copy it to the clipboard as a PNG of its full size (twice that on a Retina screen), or save it in a folder you choose once. <kbd>C</kbd> and <kbd>S</kbd> do the same for the selected design.
- 🎯 **Focus & Zoom-to-Fit**: Click a design in the list or double-click it on the canvas to fit it, <kbd>Shift</kbd> + <kbd>1</kbd> fits everything, <kbd>←</kbd> <kbd>→</kbd> step through the designs.
- 🔗 **Deep Links**: The URL follows the selected design (`http://localhost:3000/#checkout-b`), so you can share or reload a view of one design.
- ⌨️ **Keyboard-First Workflow**: Figma-like shortcuts; <kbd>?</kbd> lists them.

---

## 🚀 Quick Start

Run instantly in any project containing HTML files:

```bash
npx htmlboard
```

Or install globally:

```bash
npm install -g htmlboard
htmlboard
```

### Scaffold a Starter Project

To start with sample designs (a folder of screens and a UI kit, each file describing itself, all sharing one `styles.css` and four components):

```bash
npx htmlboard --init
```

---

## 🛠️ CLI Usage

```text
Usage:
  htmlboard [directory] [options]
  npx htmlboard [directory] [options]
  htmlboard skills <install|uninstall> [options]   Teach your AI agent to use HtmlBoard
  htmlboard migrate [directory] [--write]          Move designs.json's sizes, titles and variants into the files
  htmlboard components [directory] [--force]       Add components.js: files in components/ become custom elements
  htmlboard catalog [directory]                    What the designs share: stylesheets, scripts, components
  htmlboard check [directory or file] [-p <port>]  What went wrong in the designs, as the canvas sees them in a browser
  htmlboard shot <file> [-s <selector>] [--max <px>]  A design, or one element of it, as a PNG (for your AI agent)

Options:
  -p, --port <number>   Port to listen on (default: 3000)
  -d, --dir <path>      Directory to serve HTML artboards from (default: .)
  -r, --root <path>     Serve files from this parent folder, so artboards can link to
                        shared files outside the designs folder (default: the designs folder)
  -o, --open            Open the explorer automatically in default browser
      --init            Add sample designs (two folders of artboards)
  -v, --version         Display HtmlBoard version
  -h, --help            Display help message
```

Running `htmlboard` for a folder it already shows (same folder and root, same version) doesn't start a second canvas on the next port: it prints the running one's URL, and opens it with `--open`.

### Examples

```bash
# Serve current directory on port 3000
htmlboard

# Open in browser automatically
htmlboard --open

# Serve a specific designs directory on port 8080
htmlboard ./src/designs -p 8080

# Artboards in ./design that link to the site's own ../css and ../js
htmlboard design --root .

# Start a new folder with sample designs
htmlboard ./my-new-ui --init --open

# Let the designs in ./design use components
htmlboard components design

# What the designs in ./design share, in a few lines (what the agent skill reads)
htmlboard catalog design

# What went wrong in them: script errors, missing files, cut-off text
htmlboard check design

# A design's table as a PNG, for an agent to look at
htmlboard shot design/01-screens/02-customers.html -s table

# See what moving ./design/designs.json into its files would do, then do it
htmlboard migrate design
htmlboard migrate design --write
```

---

## 🤖 Working with LLMs (AI-Assisted Prototyping)

HtmlBoard is built from the ground up to pair with AI coding agents (Claude, Gemini, Codex, ChatGPT, Antigravity, Cursor).

### Install the agent skills

HtmlBoard ships [Agent Skills](https://agentskills.io) that teach your agent how to use it. An agent keeps only each skill's one-line description in mind and reads a skill when a task calls for it, so the ones it rarely needs cost almost nothing until then:

| Skill | What it teaches | Read |
| :--- | :--- | :--- |
| `htmlboard` | Start the canvas; write, size, name and group designs; shared styles; size and state variants; the catalog, the check and shots | For any design work |
| `htmlboard-components` | The component file: attributes, slots, scoped CSS, a script, its first-line example | Before writing or changing a component |
| `htmlboard-designs-json` | Curating the canvas with `designs.json`, and `htmlboard migrate` | When the designs folder has a `designs.json` |

Install them in your project:

```bash
npx htmlboard skills install
```

This writes them in `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex and other agents that read `.agents/skills`). Commit them so everyone working on the project gets them. Then start a new agent session and just ask for a design.

```bash
npx htmlboard skills install --global         # for your user (~/.claude/skills, ~/.agents/skills), all projects
npx htmlboard skills install --agent claude   # only one agent: claude | agents | all (default)
npx htmlboard skills install --force          # update a copy you edited locally
npx htmlboard skills uninstall                # remove them (accepts the same --global / --agent)
```

Running `install` again after upgrading HtmlBoard updates the skills; a copy you edited is kept unless you pass `--force`.

### The workflow

1. **Ask your LLM to generate artboards:**
   > *"Create 3 design explorations for our checkout flow in `designs/03-checkout/`."*

   With the skills, the agent writes `01-one-page.html`, `02-steps.html`, `03-express.html`, each with its size in a `<meta>` tag. They show up as a new "checkout" row, in that order.

2. **Run HtmlBoard in the background:**
   ```bash
   npx htmlboard
   ```

3. **Watch the canvas update live:**
   As the LLM writes or refines each HTML file, HtmlBoard detects the file change and reloads the iframe on the canvas immediately. You never have to refresh your browser or hunt for file URLs.

### What the designs share: `htmlboard catalog`

Before an agent writes a new design, it needs to know what the others use: the stylesheet's variables and classes, the components and how to write them. Reading every file for that costs tokens in every session. `htmlboard catalog` reads them instead and prints a summary (the skill runs it). On the samples, shortened:

```text
$ npx htmlboard catalog designs
designs: 4 designs. Paths below are from this folder.

Stylesheets
  styles.css · all 4 designs
    :root { --bg: #0b0d13; --surface: #141724; --surface-2: #1c2030; --border: #23283c;
      --text: #f1f5f9; --text-muted: #94a3b8; --text-subtle: #64748b; --accent: #6366f1; … }
    classes .muted .label .row .page-title .page-sub .app .app-main .app-content .card .btn
      .btn-primary .btn-secondary .btn-outline .btn-danger .badge .badge-dot .badge-emerald …

Scripts
  components.js · all 4 designs

Components (components/)
  <stat-card label value trend [warn]> · 2 designs: 01-screens/01-dashboard.html, 02-ui-kit/01-overview.html
    e.g. <stat-card label="Monthly Recurring Revenue" value="$184,290" trend="▲ +12.4% vs last mo"></stat-card> …
  <tx-item icon name meta amount [positive]> · 2 designs: 01-screens/03-mobile.html, 02-ui-kit/01-overview.html
    e.g. <tx-item icon="💼" name="Client Invoice #1042" meta="Yesterday • Wire Transfer" amount="+$3,450.00" positive></tx-item> …
```

It describes whatever the project has and asks for nothing:
- **Stylesheets** with any name, in any folder: the ones the designs link or `@import` (CDN ones by their URL), and the ones at the top of the folder that no design links yet.
- **Variables** under the selector that declares them, so a dark theme's values show too.
- **Components**: their attributes come from their markup (`{{name}}`), their script and their CSS (`&[warn]` is a flag, `&[size="lg"]` a value).

On the samples it is 2 KB instead of the 9 KB of `styles.css` and `components/`, and the gap grows with the project: a stylesheet's rules don't show, only what they define.

### Checking the designs: `htmlboard check`

An agent can't see the canvas, and a screenshot costs it many tokens, when it can take one at all. `htmlboard check` asks the canvas to look instead: each design loads again, out of sight, in a frame of its size, and what went wrong comes back as text:

```text
$ npx htmlboard check designs
Checked 6 designs in designs (the canvas at http://localhost:3000): 2 with problems, 1 with notes.

01-screens/02-customers.html · Customers
  error  TypeError: Cannot read properties of null (reading 'append') (01-screens/02-customers.html:88)
  error  <org-cel> isn't built: there is no components/org-cel.html
  error  missing file: img/acme.svg (<img>)
  layout cut at the right edge (the frame is 1280 px wide): table.table reaches 1342
  layout text cut off by p.plan (overflow: hidden): "Enterprise annual plan"

01-screens/03-mobile.html · Mobile
  layout text spills out of .btn: "Confirm and continue"

02-print/01-flyer.html · Flyer
  note   content goes on below the frame, down to 1460 px (the frame is 1350 px tall)
```

- **What it finds:** script errors and `console.error`; files that aren't there (a stylesheet's fonts and images, a fetch's data too); components that weren't built; fonts that didn't load; a page that shows nothing; content cut at the frame's right edge; text cut off by a box that hides its overflow, or spilling out of its box. A note says when content goes on below a frame of fixed height: fine for a screen that scrolls, not for a flyer.
- **What it leaves alone:** what a design means to do, such as text that ends in an ellipsis or is clamped, boxes that scroll, and content hidden or moved off the page on purpose. It doesn't judge looks (colors, spacing, alignment).
- **It runs in a browser**: the one the canvas is open in, or with none open (a background session, nobody at the computer), one the canvas opens out of sight: Chrome, Chromium or Edge, else Firefox, headless. `HTMLBOARD_BROWSER=<path>` names another, `HTMLBOARD_BROWSER=none` turns this off. It quits after a minute without checks or shots, and when the canvas stops. Nothing is downloaded: the browser only opens the canvas's page, which does the work.
- **With no canvas running** for the designs (CI, a fresh worktree), the check starts one for itself, out of sight, and stops it when it's done. That one serves the designs folder (the nearest folder above the file with a `designs.json`, `styles.css`, `components.js` or `components/`), so if the designs link files outside it, add `--root <folder>` as you would to the canvas; the report says so when files are missing.
- Each check loads the files as they are on disk, so it can run right after a save. Pages shown in frames get a small script first in their `<head>` (`/__explorer/probe.js`) to hear what goes wrong from the start, and to set the theme they're shown in before their own scripts run; it only listens in the frames the check loads, and a design opened on its own doesn't get it.
- A file or a folder checks just those designs: `htmlboard check designs/01-screens/02-customers.html`. It finds the canvas on ports 3000 to 3020 (`-p` for another) and exits with 1 when there are problems, 2 when it can't check. `--json` gives the report as data.
- **In themes:** `--theme dark` checks the designs in that theme; `--themes all` checks each one in its default and in every theme it has (`--themes light,dark`: in those), and a problem found in some of them only says which: `layout [dark] text spills out of .btn: "Confirm"`. Without either, a design is checked in its own theme, in the system's light mode, so the check sees the same on any computer.

### Looking at a design: `htmlboard shot`

The check doesn't judge looks: colors, spacing, alignment. For those an agent needs to see the design, and `htmlboard shot` gives it a PNG to read:

```text
$ npx htmlboard shot designs/01-screens/02-customers.html -s table
/tmp/htmlboard-shots-you/designs-dd2158/01-screens-02-customers--table.png (934 × 358)
```

- **Drawn by the canvas**, like the check, and in the same browser (yours, or one out of sight; with no canvas running, the shot starts one): the design loads afresh, out of sight, in a frame of its size (as tall as its page when it has no height of its own), and the browser draws it as Copy image does, from the files as they are on disk.
- **A part costs less:** an agent pays for an image by its area, roughly width × height / 750 tokens for Claude, so a 1440 × 900 screen is about 1.7k tokens. `-s <selector>` shoots the first element the CSS selector matches, which is cheaper and sharper; `--max 1000` makes the longest side at most 1000 px for an overview; `--scale 2` doubles the pixels for a close look at a detail.
- **In a theme:** `--theme dark` shows the design in that theme, as the canvas's theme switch does (see [Themes](#-how-designs-are-found)).
- **Where it goes:** without `-o`, in a folder of your system's temporary files, one per designs folder, named after the design, the selector and the theme, so a new shot of the same replaces the last. It prints the path and the size; `--json` says it as data.
- It exits with 1 when it can't take the shot as asked (no element matches the selector, or the file isn't a design on the canvas) and 2 when it can't reach the canvas. What an image can't show, a shot can't either: other sites' images that don't allow it, pages inside the page, shadow DOM.

---

## 📂 How Designs Are Found

Every `.html` file under the folder is a design (hidden folders, `node_modules`, `dist`, `build` and the [components](#-components) in `components/` aside):

- **Sections are folders.** Each folder is a row on the canvas, named after the folder; the files at the top of the folder make a first row without a title ("Top level" in the list).
- **In the list, a section folds** under its title, and **its eye hides it from the canvas**: its designs unload and the rows below move up, which keeps a canvas of many designs light. <kbd>Alt</kbd> + click an eye shows only that section (again: all of them); the buttons above the sections fold, unfold, show or hide them all. A hidden section's designs stay in the list, faded, and the search still finds them: clicking one (or a link to it) shows its section. The list remembers what you folded and hid, for each project.
- **Number prefixes set the order** of files and folders: `01-…`, `02-…`, `10-…` (up to three digits; `2` comes before `10`). They don't show in names or in links, so reordering breaks nothing.
- **A file describes itself** in its `<head>`:

```html
<title>Checkout</title>                                         <!-- its name -->
<meta name="description" content="One page, address first">    <!-- its description -->
<meta name="htmlboard" content="width=390, height=844">         <!-- its size (and category=…) -->
<meta name="htmlboard:label" content="light">                   <!-- added to its name: "Checkout · light" -->
<meta name="htmlboard:variant" content="?state=empty · empty">  <!-- one more frame: "Checkout · empty" -->
<meta name="htmlboard:variant" content="width=768, height=1024 · tablet">  <!-- and at a tablet's size -->
<meta name="htmlboard:themes" content="class: light, dark">      <!-- its themes, when not data-theme -->
```

| Tag | What it says |
| :--- | :--- |
| `<title>` | The design's name (without one: the file's name, prefix and extension off). |
| `<meta name="description">` | Its description, shown in the list and found by the search. |
| `<meta name="htmlboard" content="…">` | `width=…`, `height=…`, `category=…` (`mobile`, `tablet`, `desktop`, `components` or your own word), or `skip` to leave the file out (partials, templates). |
| `<meta name="htmlboard:label">` | Text added to the name of the file's own frame, when it has variants. |
| `<meta name="htmlboard:variant">` | One more frame of the same file: with a query string (`?state=empty`), at another size (`width=390, height=844`, so a responsive page shows on a phone too), or both; then its label. As many as you like; they follow the file. |
| `<meta name="htmlboard:themes">` | How its themes apply, when it isn't the `data-theme` attribute on `<html>`: the attribute, then the themes (`data-mode: day, night`; `class: light, dark` for classes on `<html>`). Without it, the canvas finds them (see **Themes** below). |

**Sizes.** The width is the frame's viewport: the page's CSS needs it before it renders. Give the height for designs of a fixed size (a phone screen, a flyer: the frame is that tall and cuts the rest); leave it out and the frame grows with the page. Without a size, words in the path decide (`mobile` → 390 × 844, `tablet` → 768 × 1024, `desktop` → 1280 × 800, `component` → 720 × 600), else 1200 wide.

**Categories** drive the filters. Left out, they come from words in the path, then from the size when it is a screen's (a phone's width, a tablet's 3:4, a desktop's landscape); flyers, boards and other formats get none and show under **All**.

**Shared styles.** Designs link one stylesheet for what they share (tokens, base styles, classes like `.btn` and `.card`) and keep only their own CSS in their `<style>`, so they stay consistent and each new design is shorter to write. The samples use a `styles.css` at the top of the folder (`<link rel="stylesheet" href="../styles.css">`), and the agent skill tells LLMs to look it up (`htmlboard catalog`), use it and grow it. Editing it reloads every design that links it.

**Themes.** The theme button in the toolbar (<kbd>T</kbd>, <kbd>Shift</kbd> + <kbd>T</kbd> back) shows every design in one of the project's themes, with no variants or scripts. It sets the theme on each page's `<html>` (`data-theme="dark"`), and for light and dark also its frame's `color-scheme`, which pages that follow the system's mode (`prefers-color-scheme`, `light-dark()`) see. A page that loads in a theme starts in it, so its scripts see it too; back to each page's own, the pages load again. The canvas finds the themes in the stylesheets (`[data-theme="…"]` rules, and light and dark for pages that follow the system); a project that switches another attribute, or classes on `<html>`, names them in `designs.json` (`"themes"`) or in a design's `<meta name="htmlboard:themes">`. The pictures shown zoomed out follow the switch, and checks and shots take a theme: `htmlboard check --themes all`, `htmlboard shot --theme dark`. Firefox and current Chrome show the system's light or dark in a frame as its `color-scheme` says; in a browser that doesn't (an older Chromium, as in some desktop apps), designs that follow the system stay in its mode, while attribute themes switch in any browser.

---

## 🧩 Components

Designs repeat markup too: the same sidebar on every screen, a dozen rows of a list. Written as a component, it is one tag in each design, and one file to change. Every file in `components/` (at the top of the designs folder) is a custom element named after it, built by `components.js`, which designs load once next to their stylesheet:

```html
<link rel="stylesheet" href="../styles.css">
<script type="module" src="../components.js"></script>
…
<app-sidebar active="Customers"></app-sidebar>
<tx-item icon="☕" name="Blue Bottle Coffee" meta="Oct 26 • Food & Beverage" amount="-$6.75"></tx-item>
```

A component is a piece of HTML, `components/tx-item.html`:

```html
<!-- <tx-item icon="💼" name="Client Invoice #1042" meta="Yesterday" amount="+$3,450.00" positive></tx-item> -->
<div class="icon">{{icon}}</div>
<div class="what">
  <div class="name">{{name}}</div>
  <div class="muted">{{meta}}</div>
</div>
<div class="amount">{{amount}}</div>

<style>
  & { display: flex; align-items: center; gap: 14px; }
  .icon { width: 40px; height: 40px; border-radius: 12px; background: var(--surface-2); }
  &[positive] .amount { color: var(--emerald); }
</style>
```

| In the file | What it does |
| :--- | :--- |
| A comment first | An example of use: the component's documentation, for people and agents, and its preview on the canvas. |
| `{{name}}` | The element's `name="…"` attribute, as text. |
| `<slot>`, `<slot name="x">` | The element's content; its children with `slot="x"`. What a slot holds shows when nothing fills it. |
| `<style>` | CSS for this element only (`&` is the element, a block box by default), added once to the pages that use it. |
| `<script>` | Runs for each element once it is built, with `this` as the element: for the little that markup and CSS can't do, like marking the current link. |

- **They work with your stylesheet.** Components are built in the light DOM, with no shadow root in the way, so `styles.css` reaches inside: they use the same classes as the designs (`card`, `btn`, `muted`). A component's CSS comes after `styles.css` and before the design's own `<style>`, so a design can still adjust one element.
- **Variants are attributes styled in CSS** (`&[positive]`). There is no template logic to learn; a list is several elements.
- **Relative links start from the component's file**, so they work from every design.
- **`components.js` is a file in your project**, so designs work on any static server. `--init` adds it; `htmlboard components [dir]` adds it to a designs folder. After upgrading htmlboard, `htmlboard components [dir] --force` replaces an older copy (and any edits you made to it).
- **Saving a component reloads the designs that use it.** Component files aren't designs; `designs.json` can show them on the canvas (below).
- **`htmlboard catalog` lists them** with their attributes, the example each one starts with and the designs that use them.
- HTML has no self-closing custom elements: write `<tx-item …></tx-item>`, not `<tx-item />`. And a component can't be a table's row or cell itself (the browser moves it out of the `<table>`), but it works inside a cell: `<td><org-cell …></org-cell></td>`.

---

## 📋 `designs.json` (Optional)

A `designs.json` in the folder curates the canvas when folders aren't enough: section titles with accents and capitals, an order across folders, a name or size the file doesn't give. The files still say the rest:

```json
{
  "title": "Wallet app",
  "sections": [
    { "title": "Onboarding", "designs": ["01-onboarding/01-welcome.html", "01-onboarding/02-sign-up.html"] },
    { "title": "Checkout · round 2", "folder": "03-checkout" },
    {
      "title": "Print",
      "description": "Flyers for the launch",
      "designs": [{ "file": "flyer.html", "title": "Launch flyer", "height": 1350 }]
    }
  ]
}
```

- Sections come in their order, designs in theirs. An entry is a file name, or `{ "file", … }` with values that win over the file's (`title`, `description`, `width`, `height`, `category`, `tags`, `id`). A `file` may carry a query string to place a variant itself.
- A file's variants follow it unless designs.json lists them. `"folder"` brings a whole folder (in prefix order).
- **Designs it doesn't list still show**, after the ones it does: in the section that holds their folder, else in their folder's own section (the files at the top in "Unlisted"). `"unlisted": "hide"` shows only what it lists.
- **Components show on the canvas with `"components": "show"`**, each alone in its frame, from the example its file starts with, in a "components" section after the designs. They are 480 wide, unless the component's file says `<meta name="htmlboard" content="width=1040">`. A section can also list them (`"components/tx-item.html"`) or bring them all (`"folder": "components"`). A `designs.json` that only says `{ "components": "show" }` leaves the rest of the canvas as the files make it.
- `"themes"` says how the designs' themes apply, when it isn't the `data-theme` attribute on `<html>`, or which they are: `{ "attribute": "class", "values": ["light", "dark"] }` (classes on `<html>`), or just `["light", "dark"]`. The theme switch, `htmlboard check --themes all` and `htmlboard shot --theme` use them; without it, the canvas finds them in the stylesheets. An entry can say its own (`{ "file": "…", "themes": … }`).
- `name` and `artboards` are synonyms of `title` and `designs`.

### Moving an existing `designs.json` into the files

```bash
npx htmlboard migrate design          # shows what it would do, and checks the canvas stays the same
npx htmlboard migrate design --write  # does it
```

It writes each file's size, category, label, variants and description as tags after its `<title>`, and leaves designs.json with the sections, their titles and order, and the values the files can't say (a name that isn't the file's `<title>` plus a label, say).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| Drag, <kbd>Space</kbd> + drag | Move around |
| Scroll (<kbd>Shift</kbd>: sideways) | Move around |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + scroll, pinch | Zoom, anchored to the pointer |
| <kbd>+</kbd> / <kbd>−</kbd> | Zoom in / out |
| <kbd>Shift</kbd> + <kbd>0</kbd> | Zoom to 100% |
| <kbd>Shift</kbd> + <kbd>1</kbd> | Fit everything (what the search keeps) |
| <kbd>Shift</kbd> + <kbd>2</kbd>, double-click | Fit the design |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next design |
| <kbd>Enter</kbd> | Open the selected design on its own |
| <kbd>C</kbd> / <kbd>S</kbd> | Copy / save the selected design as an image (<kbd>Shift</kbd> + <kbd>S</kbd>: choose the folder) |
| <kbd>T</kbd> | Every design in the next theme, then each page's own again (<kbd>Shift</kbd> + <kbd>T</kbd>: the one before) |
| <kbd>/</kbd> | Search (<kbd>Enter</kbd> fits the first match, <kbd>Esc</kbd> clears) |
| <kbd>1</kbd> – <kbd>4</kbd> | Show all, mobile, tablet, desktop (<kbd>5</kbd> on: the other categories) |
| <kbd>R</kbd> | Reload the designs |
| <kbd>\</kbd> | Show or hide the list |
| <kbd>?</kbd> | Show the shortcuts |
| <kbd>Esc</kbd> | Deselect, then clear the search, then the filter |

On the canvas the designs don't take clicks: the canvas takes every click and scroll, so <kbd>Ctrl</kbd> + scroll never zooms the page itself. Use **Open** (or <kbd>Enter</kbd>) to try a design's links and hover states on its own.

**Zoomed out, pictures.** Below 25% zoom, each design shows a picture of its page instead of the page itself, so a canvas of hundreds of designs stays light: its animations stop, and nothing is drawn again until the view changes. The pictures are made in the background, a few at a time, nearest the middle of the screen first, once a page has loaded and built itself; until then, and while a saved design's picture is made again, its page shows as before. Zoom in past 25% and the designs come back to life once the canvas stops. A picture has the limits of an image of a design (below).

**Images of a design.** Hovering a design shows two buttons over its top right corner. **Copy** puts it in the clipboard as a PNG, to paste anywhere; **Save** writes it in a folder you pick the first time (the canvas remembers it for the project, <kbd>Shift</kbd> + click picks another), as `<design id>.png`, then `-2`, `-3`… so it never replaces an image. Browsers without folder access (Firefox, Safari) download it instead. Your browser draws the image from the page as its frame shows it, with its stylesheets, fonts and images, at the frame's size and your screen's pixel density. A few things can't be in it: images from other sites that don't allow it, pages inside the page (iframes), and shadow DOM.

---

## 🔌 Programmatic API

You can also embed HtmlBoard into your own build tools, testing pipelines, or dev environments:

```javascript
import { startServer } from 'htmlboard';

const instance = await startServer({
  dir: './designs',
  port: 3000
});

console.log(`HtmlBoard running at ${instance.url}`);

// Later, when done:
// await instance.close();
```

The list of designs is there too, as the explorer gets it:

```javascript
import { loadDesignsManifest } from 'htmlboard';

const { sections } = loadDesignsManifest('./designs');
// → [{ id: 'screens', name: 'screens', artboards: [{ id, title, file, width, height, category }, …] }, …]
```

The skill installer is exported too:

```javascript
import { installSkills } from 'htmlboard';

installSkills({ dir: process.cwd(), agent: 'all' });
// → [{ skill: 'htmlboard', path: '…/.claude/skills/htmlboard', status: 'installed' }, …]
```

And so is the components installer:

```javascript
import { installComponents } from 'htmlboard';

installComponents({ dir: './designs' });
// → { path: '…/designs/components.js', status: 'installed' }
```

And the catalog, as data or as the text `htmlboard catalog` prints:

```javascript
import { buildCatalog, formatCatalog } from 'htmlboard';

const catalog = buildCatalog('./designs'); // { root } for links that start with "/", like --root
// → { designs: ['01-screens/01-dashboard.html', …],
//     stylesheets: [{ path: 'styles.css', users: [{ design: '01-screens/01-dashboard.html' }, …], variables, classes, keyframes, fonts }, …],
//     scripts: [{ path: 'components.js', users }],
//     components: [{ tag: 'tx-item', attributes: [{ name: 'icon' }, …, { name: 'positive', flag: true }], slots, example, users }, …] }
console.log(formatCatalog(catalog));
```

And the check (the server answers it at `GET /api/check`, `?only=<file or folder>` for some of the designs, opening a browser out of sight when none has the canvas open; `startServer({ browser: null })` turns that off):

```javascript
import { runCheck, formatReport } from 'htmlboard';

const { canvas, report } = await runCheck('./designs'); // { port } when it isn't on 3000 to 3020; with none running, one is started
// { theme: 'dark' } checks them in a theme; { themes: 'all' } each in its default and every theme it has
// → report: { dir, root, designs: [{ file, title, width, height, problems: [{ level: 'error', kind: 'missing', path: '/img/logo.png', tag: 'img' }, …] }, …] }
console.log(formatReport(report, { url: canvas.url }));
```

And a shot (the server answers it at `GET /api/shot?file=<design>&selector=<css>&max=<px>&scale=<n>`, the PNG as base64):

```javascript
import fs from 'node:fs';
import { runShot, shotPath } from 'htmlboard';

const { canvas, shot } = await runShot('./designs/home.html', { selector: '.hero', max: 1000 }); // { theme: 'dark' } too
// → shot: { file: 'home.html', title: 'Home', width: 1000, height: 412, matches: 1, png: <Buffer> }
fs.writeFileSync(shotPath(canvas.dir, shot.file, { selector: '.hero' }), shot.png);
```

---

## 📂 Project Structure

```text
htmlboard/
├── bin/
│   └── htmlboard.js      # CLI executable
├── src/
│   ├── index.js          # Library entry point & API exports
│   ├── server.js         # HTTP server, SSE live reload
│   ├── designs.js        # Which designs a folder holds: files, their tags, designs.json
│   ├── components.js     # Components: their previews, `htmlboard components`
│   ├── catalog.js        # What the designs share: `htmlboard catalog`
│   ├── canvases.js       # The canvases running on this machine, asking one, starting one for a command
│   ├── browser.js        # A browser to open the canvas in out of sight (headless)
│   ├── check.js          # `htmlboard check`: asks the canvas, prints its report
│   ├── shot.js           # `htmlboard shot`: asks the canvas for a PNG
│   ├── migrate.js        # `htmlboard migrate`
│   ├── skills.js         # `htmlboard skills` installer
│   ├── client/           # The canvas
│   │   ├── index.html    # Explorer shell: list, canvas, toolbar, shortcuts
│   │   ├── explorer.css  # Dark chrome, dot grid
│   │   ├── explorer.js   # Layout, pan/zoom, search, live reload
│   │   ├── check.js      # Checks the designs in frames out of sight, for `htmlboard check`
│   │   ├── shot.js       # A design, or one element, as a PNG, for `htmlboard shot`
│   │   ├── theme.js      # Themes: how a page is shown in one, and which ones its stylesheets have
│   │   ├── picture.js    # A design as an image, drawn by the browser (copy, save, zoomed out, shots)
│   │   ├── probe.js      # First in framed pages: sets their theme, notes errors for the check
│   │   ├── favicon.svg, logo.svg, mark.svg
│   │   └── fonts/        # Inter and Bricolage Grotesque (OFL)
│   └── templates/        # The sample designs `--init` adds
│       ├── styles.css    # Their shared tokens and classes
│       ├── components.js # Turns components/*.html into custom elements (copied into projects)
│       ├── components/   # Sidebar, top bar, stat card, transaction row
│       ├── 01-screens/   # Dashboard, customers, mobile feed
│       └── 02-ui-kit/
├── skills/
│   ├── htmlboard/        # Agent skills (SKILL.md each) copied by `htmlboard skills install`
│   ├── htmlboard-components/
│   └── htmlboard-designs-json/
├── brand/                # The logo's files (from design/tools/logo.py)
├── design/               # htmlboard's own designs, on its own canvas: `npx htmlboard design --root .`
├── package.json
├── README.md
└── LICENSE
```

---

## 📄 License

MIT © Luiz Carlos & Contributors

The explorer ships the Inter and Bricolage Grotesque fonts under the SIL Open Font License 1.1 (see `src/client/fonts/`).
