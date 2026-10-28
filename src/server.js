import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, 'client');
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

// Supported MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4'
};

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  '.vscode',
  '.idea',
  '.gemini',
  '.agents'
]);

/**
 * Extract <title> content from HTML text if available
 */
function extractTitleFromHtml(content, fallbackName) {
  const match = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (match && match[1]?.trim()) {
    return match[1].trim();
  }
  return fallbackName
    .replace(/\.html$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Default frame size for each category */
const CATEGORY_SIZES = {
  mobile: [390, 844],
  tablet: [768, 1024],
  components: [720, 600],
  desktop: [1280, 800],
  responsive: [1200, 800]
};

/**
 * Guess an artboard's category from words in its path, then from its width
 */
export function inferCategory(file, width) {
  const lower = file.toLowerCase();
  if (/mobile|phone|iphone/.test(lower)) return 'mobile';
  if (/tablet|ipad/.test(lower)) return 'tablet';
  if (/component|\bui\b|atomic/.test(lower)) return 'components';
  if (/desktop|laptop|screen/.test(lower)) return 'desktop';
  if (width) {
    if (width <= 480) return 'mobile';
    if (width <= 1024) return 'tablet';
    return 'desktop';
  }
  return 'responsive';
}

function slugify(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** True when target is base itself or inside it */
function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Scan target directory recursively for HTML files to auto-discover
 */
export function discoverDesigns(baseDir) {
  const artboards = [];

  function scan(currentDir, relativePath = '') {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        scan(fullPath, relPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        let title = '';
        let fileContent = '';
        try {
          fileContent = fs.readFileSync(fullPath, 'utf8');
          title = extractTitleFromHtml(fileContent, entry.name);
        } catch {
          title = entry.name;
        }

        const category = inferCategory(relPath);
        const [width, height] = CATEGORY_SIZES[category];

        const sectionName = relativePath ? relativePath.replace(/[\\/]/g, ' / ') : 'Root Designs';

        artboards.push({
          id: slugify(relPath.replace(/\.html$/i, '')),
          title,
          file: relPath.replace(/\\/g, '/'),
          category,
          width,
          height,
          sectionName,
          tags: [category]
        });
      }
    }
  }

  scan(baseDir);

  // Group into sections
  const sectionsMap = new Map();
  for (const board of artboards) {
    const sName = board.sectionName;
    if (!sectionsMap.has(sName)) {
      sectionsMap.set(sName, {
        id: sName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: sName,
        description: `HTML artboards discovered in ${sName}`,
        artboards: []
      });
    }
    const { sectionName, ...rest } = board;
    sectionsMap.get(sName).artboards.push(rest);
  }

  const projectName = path.basename(path.resolve(baseDir)) || 'Design Explorer';

  return {
    title: projectName,
    description: 'Auto-discovered HTML artboards in workspace',
    autoDiscovered: true,
    sections: Array.from(sectionsMap.values())
  };
}

/**
 * Fill in what a manifest may leave out, so the explorer always gets
 * `sections[].{id, name, artboards[].{id, title, file, category}}`.
 * Accepts the short form too: `sections[].title` and `sections[].designs[]`
 * with only `{ file, title, width, height }`.
 * `prefix` is prepended to every file (the designs folder relative to the served root).
 */
export function normalizeManifest(manifest, prefix = '') {
  const usedIds = new Set();
  const uniqueId = (wanted) => {
    let id = wanted || 'artboard';
    for (let n = 2; usedIds.has(id); n++) id = `${wanted}-${n}`;
    usedIds.add(id);
    return id;
  };

  const sections = (Array.isArray(manifest.sections) ? manifest.sections : []).map((section, i) => {
    const name = section.name ?? section.title ?? `Section ${i + 1}`;
    const boards = section.artboards ?? section.designs ?? [];
    return {
      ...section,
      id: section.id ?? (slugify(name) || `section-${i + 1}`),
      name,
      artboards: boards.filter((board) => board && board.file).map((board) => {
        const file = prefix ? path.posix.join(prefix, board.file) : board.file;
        return {
          ...board,
          id: uniqueId(board.id ?? slugify(board.file.replace(/\.html?(?=$|\?)/i, ''))),
          title: board.title ?? board.file,
          file,
          category: board.category ?? inferCategory(board.file.split('?')[0], board.width)
        };
      })
    };
  });

  return { ...manifest, sections };
}

/**
 * Load designs configuration from designs.json or auto-discover.
 * With `rootDir` (a folder containing baseDir), artboard paths are given relative to it.
 */
export function loadDesignsManifest(baseDir, rootDir = baseDir) {
  const prefix = path.relative(rootDir, baseDir).split(path.sep).join('/');
  const configPath = path.join(baseDir, 'designs.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const data = JSON.parse(raw);
      return {
        ...normalizeManifest(data, prefix),
        autoDiscovered: false
      };
    } catch (err) {
      console.warn(`[htmlboard] Failed parsing designs.json: ${err.message}. Falling back to auto-discovery.`);
    }
  }
  return normalizeManifest(discoverDesigns(baseDir), prefix);
}

/** Folders the watcher leaves alone: hidden ones (.git, .vscode, …) and dependencies */
const skipWatching = (name) => name.startsWith('.') || name === 'node_modules';

/**
 * Watch a folder and everything under it, calling onChange(path, isFolder) with the path (relative,
 * with forward slashes) of every file or folder created, changed or removed.
 * macOS and Windows watch a whole tree natively. On Linux Node emulates that with one watcher per
 * file, which loses a file for good once it is saved by replacing it (writing a copy and renaming
 * it over, as many editors do), so there every folder gets its own watcher instead.
 * Returns a function that stops watching.
 */
export function watchTree(rootDir, onChange) {
  const relative = (full) => path.relative(rootDir, full).split(path.sep).join('/');
  const skipped = (rel) => rel.split('/').some(skipWatching);

  if (process.platform !== 'linux') {
    const watcher = fs.watch(rootDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const rel = String(filename).split(path.sep).join('/');
      if (skipped(rel)) return;
      let isFolder;
      try {
        isFolder = fs.statSync(path.join(rootDir, rel)).isDirectory();
      } catch {
        isFolder = path.extname(rel) === ''; // gone: a name without an extension was likely a folder
      }
      onChange(rel, isFolder);
    });
    return () => watcher.close();
  }

  const watchers = new Map(); // folder → its watcher
  const unwatch = (dir) => {
    for (const [watched, watcher] of watchers) {
      if (watched === dir || watched.startsWith(dir + path.sep)) {
        watcher.close();
        watchers.delete(watched);
      }
    }
  };
  const watch = (dir) => {
    if (watchers.has(dir)) return;
    let watcher;
    try {
      watcher = fs.watch(dir, (eventType, name) => {
        if (!name) return;
        const full = path.join(dir, String(name));
        const rel = relative(full);
        if (!rel || rel.startsWith('..') || skipped(rel)) return;
        let isDir = false;
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch {
          // Removed
        }
        const wasDir = watchers.has(full);
        if (isDir) watch(full);
        else if (wasDir) unwatch(full);
        onChange(rel, isDir || wasDir);
      });
    } catch {
      return; // gone already, or unreadable
    }
    watcher.on('error', () => unwatch(dir));
    watchers.set(dir, watcher);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Unreadable: its own watcher still reports what happens in it
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !skipWatching(entry.name)) watch(path.join(dir, entry.name));
    }
  };

  watch(rootDir);
  return () => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}

/**
 * Find the next available port using net.createServer
 */
export function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    tester.once('listening', () => {
      const port = tester.address().port;
      tester.close(() => resolve(port));
    });
    tester.listen(startPort);
  });
}

/**
 * Creates and starts the HtmlBoard server
 */
export function createServer(options = {}) {
  const targetDir = path.resolve(options.dir || process.cwd());
  // Files are served from rootDir, so artboards can link to shared files above the designs folder
  const rootDir = path.resolve(options.root || targetDir);
  if (!isInside(rootDir, targetDir)) {
    throw new Error(`The designs folder (${targetDir}) must be inside the root (${rootDir})`);
  }
  const manifestFile = path.posix.join(path.relative(rootDir, targetDir).split(path.sep).join('/'), 'designs.json');
  const clients = new Set();

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // API: Designs Manifest
    if (pathname === '/api/designs') {
      const manifest = loadDesignsManifest(targetDir, rootDir);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(JSON.stringify(manifest, null, 2));
      return;
    }

    // API: SSE Live Reload stream
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
      clients.add(res);

      const heartbeat = setInterval(() => {
        res.write(': ping\n\n');
      }, 25000);

      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }

    // API: Health status
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: VERSION, dir: targetDir, root: rootDir }));
      return;
    }

    // Serve HtmlBoard Explorer client files
    if (pathname === '/' || pathname === '/index.html') {
      serveStaticFile(path.join(CLIENT_DIR, 'index.html'), res);
      return;
    }

    if (pathname.startsWith('/__explorer/')) {
      const clientRelPath = pathname.replace('/__explorer/', '');
      const clientFilePath = path.join(CLIENT_DIR, clientRelPath);
      // Ensure path is within CLIENT_DIR
      if (!clientFilePath.startsWith(CLIENT_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      serveStaticFile(clientFilePath, res);
      return;
    }

    // Serve user artboards and assets from rootDir
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath.startsWith('/')) {
      safePath = safePath.slice(1);
    }

    const filePath = path.join(rootDir, safePath);

    // Security check: must stay within rootDir
    if (!isInside(rootDir, filePath)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStaticFile(filePath, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`File not found: ${pathname}`);
    }
  });

  function serveStaticFile(filePath, res) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error reading file');
    }
  }

  // Live reload. Saves come in bursts (an editor writing a file several times, an agent saving a
  // page and its stylesheet together), so changes are collected for 100 ms and then sent once each.
  const changed = new Map(); // path → is a folder
  let watchDebounceTimer = null;
  let stopWatching = null;

  try {
    stopWatching = watchTree(rootDir, (file, isFolder) => {
      if (file.endsWith('~') || file.endsWith('.tmp')) return; // editor scratch files
      changed.set(file, isFolder);
      clearTimeout(watchDebounceTimer);
      watchDebounceTimer = setTimeout(() => {
        const files = [...changed];
        changed.clear();
        for (const [file, isFolder] of files) {
          const eventData = JSON.stringify({
            type: file === manifestFile ? 'manifest' : isFolder ? 'folder' : 'file',
            file,
            isHtml: !isFolder && /\.html?$/i.test(file),
            timestamp: Date.now()
          });
          for (const client of clients) {
            client.write(`event: change\ndata: ${eventData}\n\n`);
          }
        }
      }, 100);
    });
  } catch (err) {
    console.warn(`[htmlboard] Live watcher error: ${err.message}`);
  }

  return {
    server,
    targetDir,
    rootDir,
    close: () => {
      clearTimeout(watchDebounceTimer);
      if (stopWatching) stopWatching();
      for (const client of clients) {
        client.end();
      }
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

/**
 * Start listening on port with auto-retry if in use
 */
export async function startServer(options = {}) {
  const requestedPort = parseInt(options.port, 10) || 3000;
  const actualPort = await findAvailablePort(requestedPort);

  if (actualPort !== requestedPort) {
    console.log(`[htmlboard] Port ${requestedPort} is in use, using ${actualPort}...`);
  }

  const { server, targetDir, rootDir, close } = createServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(actualPort, () => {
      const url = `http://localhost:${actualPort}`;
      resolve({
        server,
        port: actualPort,
        url,
        targetDir,
        rootDir,
        close
      });
    });
  });
}
