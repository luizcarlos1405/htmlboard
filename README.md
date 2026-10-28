# ✦ HtmlBoard

> **Infinite canvas and design explorer for HTML artboards — designed for humans and LLMs.**

[![npm version](https://img.shields.io/npm/v/htmlboard.svg?style=flat-square&color=6366f1)](https://www.npmjs.com/package/htmlboard)
[![license](https://img.shields.io/npm/l/htmlboard.svg?style=flat-square&color=10b981)](LICENSE)
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

- 🛸 **Infinite Canvas**: Smoothly pan, zoom (from 10% to 300%), and fly across dozens of artboards with trackpad or mouse.
- ⚡ **Zero Dependencies**: Pure native Node.js ES modules. Runs instantly with `npx htmlboard` without installing heavy packages.
- 🔄 **State-Preserving Live Reload**: Automatically watches files via Server-Sent Events (SSE). When you or an LLM edit an HTML file, the corresponding artboard updates instantly without resetting your canvas pan/zoom position.
- 🔍 **Auto-Discovery**: Point HtmlBoard at any folder. It automatically discovers all HTML files, extracts their titles, classifies them by device type, and renders them onto the canvas.
- 📐 **Declarative Manifest (`designs.json`)**: Optional structured schema to organize artboards into sections, define custom viewports (iPhone, iPad, MacBook, 4K), and attach metadata.
- 📱 **Multi-Device Categories**: One-click filters for Mobile (390×844), Desktop (1280×820), Tablet (768×1024), and Component kits.
- 🎯 **Focus & Zoom-to-Fit**: Instantly center any artboard with a click in the sidebar, or hit <kbd>F</kbd> to fit all designs on screen.
- ⌨️ **Keyboard-First Workflow**: Full suite of intuitive shortcuts matching design industry standards.

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

While HtmlBoard automatically discovers HTML files, you can add a `designs.json` file in your root folder for custom layout and organization:

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
| <kbd>Space</kbd> + <kbd>Drag</kbd> | Pan the canvas freely |
| <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Wheel</kbd> | Zoom in/out anchored to cursor |
| <kbd>+</kbd> / <kbd>-</kbd> | Zoom in / Zoom out |
| <kbd>0</kbd> | Reset zoom to 100% |
| <kbd>F</kbd> or <kbd>Shift</kbd> + <kbd>1</kbd> | Fit all artboards in viewport |
| <kbd>/</kbd> or <kbd>⌘</kbd> + <kbd>K</kbd> | Search artboards by title, tag, or path |
| <kbd>[</kbd> or <kbd>]</kbd> | Toggle navigation sidebar |
| <kbd>1</kbd> – <kbd>5</kbd> | Quick filter by device category |
| <kbd>?</kbd> | Show keyboard shortcuts modal |
| <kbd>Esc</kbd> | Close modals or blur search |

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
│   ├── client/           # The infinite canvas frontend
│   │   ├── index.html    # Explorer shell & canvas DOM
│   │   ├── explorer.css  # Dark theme styles & canvas grid
│   │   └── explorer.js   # Pan/zoom engine, SSE listener, auto-measure
│   └── templates/        # Starter scaffold templates
│       ├── designs.json  # Starter manifest
│       └── artboards/    # Sample mobile, desktop, & component screens
├── skills/
│   └── htmlboard/        # Agent skill (SKILL.md) copied by `htmlboard skills install`
├── package.json
├── README.md
└── LICENSE
```

---

## 📄 License

MIT © Luiz Carlos & Contributors
