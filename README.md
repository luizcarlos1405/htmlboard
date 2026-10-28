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

**HtmlBoard bridges this gap.** It gives you an infinite 2D canvas for HTML artboards — zero config, zero external dependencies, blazing fast, and purpose-built for AI-driven frontend prototyping.

---

## ✨ Features

- 🛸 **Infinite Canvas**: Drag or scroll to move, <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + scroll or pinch to zoom (2% to 800%), with a mouse, a trackpad or a touch screen. Names and section titles stay sharp at any zoom, and the dot grid keeps its spacing.
- ⚡ **Zero Dependencies**: Pure native Node.js ES modules, fonts included. Runs instantly with `npx htmlboard`, offline too.
- 🔄 **State-Preserving Live Reload**: The server watches the project and pushes every save (Server-Sent Events). Saving a design reloads its frame; saving a file designs use (a stylesheet, a script, an image, data) reloads just the designs that loaded it; new, removed and renamed designs show up by themselves. Your view never moves.
- 📂 **Designs That Describe Themselves**: Every HTML file is a design, each folder a section, number prefixes the order. A file says its own size, category and variants in a `<meta>` tag or two, so adding a design means writing one file — nothing to keep in sync.
- 📐 **Optional `designs.json`**: Curates when you want it (section titles, order, overrides); designs it doesn't list still show at the end, or don't (`"unlisted": "hide"`). `htmlboard migrate` moves an existing one into the files.
- 📱 **Device Filters**: **Mobile**, **Tablet** and **Desktop** (and **Components**, or your own categories) lay out just those designs, side by side, to compare them.
- 🔎 **Search**: Find designs by name, file, tags or section (case and accents don't matter); the others fade out in place.
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

To start with sample designs (a folder of screens and a folder of components, each file describing itself):

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

# See what moving ./design/designs.json into its files would do, then do it
htmlboard migrate design
htmlboard migrate design --write
```

---

## 🤖 Working with LLMs (AI-Assisted Prototyping)

HtmlBoard is built from the ground up to pair with AI coding agents (Claude, Gemini, Codex, ChatGPT, Antigravity, Cursor).

### Install the agent skill

HtmlBoard ships an [Agent Skill](https://agentskills.io) that teaches your agent how to use it: where to put artboards, how to size, name and group them (files describe themselves; `designs.json` is optional) and how to start the canvas. Install it in your project:

```bash
npx htmlboard skills install
```

This writes `.claude/skills/htmlboard/` (Claude Code) and `.agents/skills/htmlboard/` (Codex and other agents that read `.agents/skills`). Commit them so everyone working on the project gets the skill. Then start a new agent session and just ask for a design.

```bash
npx htmlboard skills install --global         # for your user (~/.claude/skills, ~/.agents/skills), all projects
npx htmlboard skills install --agent claude   # only one agent: claude | agents | all (default)
npx htmlboard skills install --force          # update a copy you edited locally
npx htmlboard skills uninstall                # remove it (accepts the same --global / --agent)
```

Running `install` again after upgrading HtmlBoard updates the skill; a copy you edited is kept unless you pass `--force`.

### The workflow

1. **Ask your LLM to generate artboards:**
   > *"Create 3 design explorations for our checkout flow in `designs/03-checkout/`."*

   With the skill, the agent writes `01-one-page.html`, `02-steps.html`, `03-express.html`, each with its size in a `<meta>` tag. They show up as a new "checkout" row, in that order.

2. **Run HtmlBoard in the background:**
   ```bash
   npx htmlboard
   ```

3. **Watch the canvas update live:**
   As the LLM writes or refines each HTML file, HtmlBoard detects the file change and reloads the iframe on the canvas immediately. You never have to refresh your browser or hunt for file URLs.

---

## 📂 How Designs Are Found

Every `.html` file under the folder is a design (hidden folders, `node_modules`, `dist` and `build` aside):

- **Sections are folders.** Each folder is a row on the canvas, named after the folder; the files at the top of the folder make a first row without a title.
- **Number prefixes set the order** of files and folders: `01-…`, `02-…`, `10-…` (up to three digits; `2` comes before `10`). They don't show in names or in links, so reordering breaks nothing.
- **A file describes itself** in its `<head>`:

```html
<title>Checkout</title>                                         <!-- its name -->
<meta name="description" content="One page, address first">    <!-- its description -->
<meta name="htmlboard" content="width=390, height=844">         <!-- its size (and category=…) -->
<meta name="htmlboard:label" content="light">                   <!-- added to its name: "Checkout · light" -->
<meta name="htmlboard:variant" content="?theme=dark · dark">    <!-- one more frame: "Checkout · dark" -->
```

| Tag | What it says |
| :--- | :--- |
| `<title>` | The design's name (without one: the file's name, prefix and extension off). |
| `<meta name="description">` | Its description, shown in the list and found by the search. |
| `<meta name="htmlboard" content="…">` | `width=…`, `height=…`, `category=…` (`mobile`, `tablet`, `desktop`, `components` or your own word), or `skip` to leave the file out (partials, templates). |
| `<meta name="htmlboard:label">` | Text added to the name of the file's own frame, when it has variants. |
| `<meta name="htmlboard:variant">` | One more frame of the same file with that query string, then its label. As many as you like; they follow the file. |

**Sizes.** The width is the frame's viewport: the page's CSS needs it before it renders. Give the height for designs of a fixed size (a phone screen, a flyer: the frame is that tall and cuts the rest); leave it out and the frame grows with the page. Without a size, words in the path decide (`mobile` → 390 × 844, `tablet` → 768 × 1024, `desktop` → 1280 × 800, `component` → 720 × 600), else 1200 wide.

**Categories** drive the filters. Left out, they come from words in the path, then from the size when it is a screen's (a phone's width, a tablet's 3:4, a desktop's landscape); flyers, boards and other formats get none and show under **All**.

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
| <kbd>/</kbd> | Search (<kbd>Enter</kbd> fits the first match, <kbd>Esc</kbd> clears) |
| <kbd>1</kbd> – <kbd>4</kbd> | Show all, mobile, tablet, desktop (<kbd>5</kbd> on: the other categories) |
| <kbd>R</kbd> | Reload the designs |
| <kbd>\</kbd> | Show or hide the list |
| <kbd>?</kbd> | Show the shortcuts |
| <kbd>Esc</kbd> | Deselect, then clear the search, then the filter |

On the canvas the designs are pictures: the canvas takes every click and scroll, so <kbd>Ctrl</kbd> + scroll never zooms the page itself. Use **Open** (or <kbd>Enter</kbd>) to try a design's links and hover states on its own.

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
│   ├── migrate.js        # `htmlboard migrate`
│   ├── skills.js         # `htmlboard skills` installer
│   ├── client/           # The canvas
│   │   ├── index.html    # Explorer shell: list, canvas, toolbar, shortcuts
│   │   ├── explorer.css  # Dark chrome, dot grid
│   │   ├── explorer.js   # Layout, pan/zoom, search, live reload
│   │   ├── favicon.svg, logo.svg, mark.svg
│   │   └── fonts/        # Inter and Bricolage Grotesque (OFL)
│   └── templates/        # The sample designs `--init` adds
│       ├── 01-screens/   # Desktop dashboard, mobile feed
│       └── 02-components/
├── skills/
│   └── htmlboard/        # Agent skill (SKILL.md) copied by `htmlboard skills install`
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
