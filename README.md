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
- 🔍 **Auto-Discovery**: Point HtmlBoard at any folder. It finds every HTML file, names it after its `<title>`, sizes it from words in its path (mobile, tablet, desktop…) and lays the folders out as rows.
- 📐 **Declarative Manifest (`designs.json`)**: Optional file to choose the sections, the order, the sizes and the names.
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

To create a new workspace with starter templates (mobile screen, desktop dashboard, and component library):

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

Options:
  -p, --port <number>   Port to listen on (default: 3000)
  -d, --dir <path>      Directory to serve HTML artboards from (default: .)
  -r, --root <path>     Serve files from this parent folder, so artboards can link to
                        shared files outside the designs folder (default: the designs folder)
  -o, --open            Open the explorer automatically in default browser
      --init            Scaffold starter designs.json and sample artboards
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

# Initialize sample templates in a new folder
htmlboard ./my-new-ui --init --open
```

---

## 🤖 Working with LLMs (AI-Assisted Prototyping)

HtmlBoard is built from the ground up to pair with AI coding agents (Claude, Gemini, Codex, ChatGPT, Antigravity, Cursor).

### Install the agent skill

HtmlBoard ships an [Agent Skill](https://agentskills.io) that teaches your agent how to use it: where to put artboards, how to size and name them, how `designs.json` works and how to start the canvas. Install it in your project:

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
   > *"Create 3 design explorations for our checkout flow in `artboards/checkout-v1.html`, `artboards/checkout-v2.html`, and `artboards/checkout-v3.html`."*

2. **Run HtmlBoard in the background:**
   ```bash
   npx htmlboard
   ```

3. **Watch the canvas update live:**
   As the LLM writes or refines each HTML file, HtmlBoard detects the file change and reloads the iframe on the canvas immediately. You never have to refresh your browser or hunt for file URLs.

---

## 📋 The `designs.json` Manifest

While HtmlBoard automatically discovers HTML files, you can add a `designs.json` file in your designs folder for custom layout and organization. Only `sections[].designs[].file` is required; the short form is enough:

```json
{
  "sections": [
    {
      "title": "Home",
      "designs": [
        { "file": "home-mobile.html", "title": "Home · phone", "width": 390, "height": 844 },
        { "file": "home-mobile.html?theme=dark", "title": "Home · phone · dark", "width": 390, "height": 844 },
        { "file": "home-desktop.html", "title": "Home · desktop", "width": 1440 }
      ]
    }
  ]
}
```

Sections are rows (top to bottom) and designs run left to right. A `file` may carry a query string, so one HTML file can show several states. Leave `height` out to let the frame grow with its page. `id` and `category` are derived from the file when left out.

The full form adds ids, descriptions (shown in the list), categories and tags (searchable); `name`/`artboards` are synonyms of `title`/`designs`:

```json
{
  "title": "Fintech Mobile & Web App",
  "description": "Exploration of screen flows, responsive layouts, and UI components",
  "sections": [
    {
      "id": "screens",
      "name": "Screen Layouts",
      "description": "Full page layouts across mobile and desktop viewports",
      "artboards": [
        {
          "id": "desktop-dashboard",
          "title": "Desktop Dashboard",
          "file": "artboards/desktop.html",
          "width": 1280,
          "height": 820,
          "category": "desktop",
          "tags": ["desktop", "dashboard", "analytics"]
        },
        {
          "id": "mobile-app",
          "title": "Mobile App Feed",
          "file": "artboards/mobile.html",
          "width": 390,
          "height": 844,
          "category": "mobile",
          "tags": ["mobile", "ios", "finance"]
        }
      ]
    },
    {
      "id": "components",
      "name": "Component Library",
      "artboards": [
        {
          "id": "ui-primitives",
          "title": "UI Kit Elements",
          "file": "artboards/components.html",
          "width": 780,
          "height": 720,
          "category": "components",
          "tags": ["design-system", "buttons", "inputs"]
        }
      ]
    }
  ]
}
```

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
| <kbd>R</kbd> | Reload the designs |
| <kbd>\</kbd> | Show or hide the list |
| <kbd>?</kbd> | Show the shortcuts |
| <kbd>Esc</kbd> | Deselect |

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
│   ├── server.js         # HTTP server, SSE live reload, auto-discovery
│   ├── skills.js         # `htmlboard skills` installer
│   ├── client/           # The canvas
│   │   ├── index.html    # Explorer shell: list, canvas, toolbar, shortcuts
│   │   ├── explorer.css  # Dark chrome, dot grid
│   │   ├── explorer.js   # Layout, pan/zoom, search, live reload
│   │   ├── favicon.svg, logo.svg, mark.svg
│   │   └── fonts/        # Inter and Bricolage Grotesque (OFL)
│   └── templates/        # Starter scaffold templates
│       ├── designs.json  # Starter manifest
│       └── artboards/    # Sample mobile, desktop, & component screens
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
