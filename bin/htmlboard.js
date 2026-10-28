#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_PATH = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));

// Parse command line arguments
function parseArgs(args) {
  const options = {
    port: 3000,
    dir: process.cwd(),
    open: false,
    init: false,
    help: false,
    version: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--open' || arg === '-o') {
      options.open = true;
    } else if (arg === '--init') {
      options.init = true;
    } else if (arg === '--port' || arg === '-p') {
      const next = args[++i];
      if (next && !next.startsWith('-')) {
        options.port = parseInt(next, 10);
      }
    } else if (arg.startsWith('--port=')) {
      options.port = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dir' || arg === '-d') {
      const next = args[++i];
      if (next && !next.startsWith('-')) {
        options.dir = next;
      }
    } else if (arg.startsWith('--dir=')) {
      options.dir = arg.split('=')[1];
    } else if (!arg.startsWith('-')) {
      // Positional directory argument e.g. `htmlboard ./my-designs`
      options.dir = arg;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
HtmlBoard v${pkg.version}
Infinite canvas and design explorer for HTML artboards — designed for humans and LLMs

Usage:
  htmlboard [directory] [options]
  npx htmlboard [directory] [options]

Options:
  -p, --port <number>   Port to listen on (default: 3000)
  -d, --dir <path>      Directory to serve HTML artboards from (default: .)
  -o, --open            Open the explorer automatically in your default browser
      --init            Scaffold starter designs.json and sample artboards in target directory
  -v, --version         Display HtmlBoard version
  -h, --help            Display this help message

Examples:
  htmlboard                     # Run in current directory on http://localhost:3000
  htmlboard --open              # Run and launch browser automatically
  htmlboard ./designs -p 8080   # Serve ./designs on port 8080
  htmlboard --init              # Initialize starter templates in current folder

Keyboard Shortcuts in Canvas:
  Space + Drag          Pan canvas
  Ctrl/Cmd + Wheel      Zoom into focal point
  + / -                 Zoom in / Zoom out
  0                     Reset zoom to 100%
  F                     Zoom to fit all artboards
  / or Cmd+K            Search artboards
  [ or ]                Toggle navigation sidebar
  ?                     Show shortcuts help dialog
`);
}

function openBrowser(url) {
  const startCmd = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
    ? 'start'
    : 'xdg-open';

  exec(`${startCmd} ${url}`, (err) => {
    if (err) {
      console.warn(`[htmlboard] Unable to auto-launch browser: ${err.message}`);
    }
  });
}

function scaffoldProject(targetDir) {
  const templatesDir = path.join(__dirname, '..', 'src', 'templates');
  const targetConfig = path.join(targetDir, 'designs.json');
  const targetArtboardsDir = path.join(targetDir, 'artboards');

  console.log(`[htmlboard] Scaffolding starter project in ${targetDir}...`);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (!fs.existsSync(targetArtboardsDir)) {
    fs.mkdirSync(targetArtboardsDir, { recursive: true });
  }

  // Copy designs.json if not present
  if (!fs.existsSync(targetConfig)) {
    const srcConfig = path.join(templatesDir, 'designs.json');
    if (fs.existsSync(srcConfig)) {
      fs.copyFileSync(srcConfig, targetConfig);
      console.log(`  ✓ Created designs.json`);
    }
  } else {
    console.log(`  ℹ designs.json already exists (skipped)`);
  }

  // Copy starter artboards
  const starterFiles = ['mobile.html', 'desktop.html', 'components.html'];
  for (const file of starterFiles) {
    const srcFile = path.join(templatesDir, 'artboards', file);
    const destFile = path.join(targetArtboardsDir, file);
    if (!fs.existsSync(destFile) && fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      console.log(`  ✓ Created artboards/${file}`);
    }
  }

  console.log(`\n🎉 Starter templates created successfully!`);
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (options.version) {
    console.log(`htmlboard v${pkg.version}`);
    process.exit(0);
  }

  const targetDir = path.resolve(options.dir);

  if (options.init) {
    scaffoldProject(targetDir);
  }

  // If directory is empty, auto-prompt or auto-scaffold
  let entries = [];
  try {
    entries = fs.readdirSync(targetDir);
  } catch (_) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const hasHtml = entries.some((e) => e.endsWith('.html')) ||
    (fs.existsSync(path.join(targetDir, 'artboards')) &&
     fs.readdirSync(path.join(targetDir, 'artboards')).some((e) => e.endsWith('.html')));
  const hasDesignsJson = fs.existsSync(path.join(targetDir, 'designs.json'));

  if (!hasHtml && !hasDesignsJson && entries.filter((e) => !e.startsWith('.')).length === 0) {
    console.log(`[htmlboard] Directory is empty. Initializing starter artboards...`);
    scaffoldProject(targetDir);
  }

  try {
    const { port, url } = await startServer({
      dir: targetDir,
      port: options.port
    });

    console.log(`
  ✦ \x1b[1m\x1b[36mHtmlBoard\x1b[0m \x1b[90mv${pkg.version}\x1b[0m
  \x1b[90mInfinite Canvas & Design Explorer for HTML Artboards\x1b[0m

  \x1b[32m➜\x1b[0m  \x1b[1mLocal:\x1b[0m   \x1b[36m${url}\x1b[0m
  \x1b[32m➜\x1b[0m  \x1b[1mTarget:\x1b[0m  \x1b[90m${targetDir}\x1b[0m
  \x1b[32m➜\x1b[0m  \x1b[1mLive:\x1b[0m    \x1b[32mWatching files for hot live reload\x1b[0m

  \x1b[90mPress \x1b[1mCtrl+C\x1b[0m\x1b[90m to stop.\x1b[0m
`);

    if (options.open) {
      openBrowser(url);
    }
  } catch (err) {
    console.error(`[htmlboard] Error starting server:`, err.message);
    process.exit(1);
  }
}

main();
