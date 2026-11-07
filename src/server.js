import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDesignsManifest } from './designs.js';
import { componentPreview } from './components.js';

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

// The probe (client/probe.js) notes what goes wrong while a page builds, for `htmlboard check`. It
// goes first in the pages the canvas shows in frames, before anything that could go wrong.
const PROBE = Buffer.from('<script src="/__explorer/probe.js"></script>');

/** A page with the probe first in it: in its <head>, else after <html> or <!DOCTYPE>, else first */
export function withProbe(page) {
  const text = page.toString('latin1'); // a byte per character: positions in it are positions in page
  for (const tag of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype\b[^>]*>/i]) {
    const match = tag.exec(text);
    if (match) {
      const at = match.index + match[0].length;
      return Buffer.concat([page.subarray(0, at), PROBE, page.subarray(at)]);
    }
  }
  return Buffer.concat([PROBE, page]);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** How long a canvas has to take a check (htmlboard check), then to do it */
const CLAIM_MS = 15000;
const CHECK_MS = 180000;

/** True when target is base itself or inside it */
function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
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
  const designsPath = path.relative(rootDir, targetDir).split(path.sep).join('/'); // '' when they're the same
  const manifestFile = path.posix.join(designsPath, 'designs.json');
  const clients = new Set();

  const send = (event, data) => {
    for (const client of clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Checks (htmlboard check). GET /api/check asks the canvases open in a browser (over the live
  // reload events) to check the designs; the first to claim the check does it, and what it posts
  // back answers the request.
  const checks = new Map(); // id → { res, claimed, timer }

  function endCheck(id, status, body) {
    const check = checks.get(id);
    if (!check) return;
    clearTimeout(check.timer);
    checks.delete(id);
    json(check.res, status, body);
  }

  // only: files or folders (from the designs folder) to check; all the designs when there's none
  function startCheck(res, only) {
    const wanted = only.map((item) => item.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, ''));
    const designs = loadDesignsManifest(targetDir, rootDir).sections
      .flatMap((section) => section.artboards)
      .map(({ id, file, title, width, height, fit }) => ({ id, file, title, width, height, fit }))
      .filter(({ file }) => {
        const own = (designsPath ? file.slice(designsPath.length + 1) : file).split('?')[0];
        return !wanted.length || wanted.some((item) => !item || own === item || own.startsWith(`${item}/`));
      });
    if (!designs.length) {
      json(res, 404, { error: wanted.some(Boolean) ? `No design on the canvas is in ${only.join(', ')}` : 'There are no designs to check' });
      return;
    }
    if (!clients.size) {
      json(res, 409, { error: "The canvas isn't open in a browser" });
      return;
    }
    const id = randomUUID();
    const check = {
      res,
      claimed: false,
      timer: setTimeout(() => endCheck(id, 504, { error: "The canvas didn't take the check (reload it in the browser)" }), CLAIM_MS)
    };
    checks.set(id, check);
    res.on('close', () => {
      if (checks.get(id) !== check) return; // answered
      clearTimeout(check.timer);
      checks.delete(id);
    });
    send('check', { id, designs });
  }

  function claimCheck(id, res) {
    const check = checks.get(id);
    if (!check || check.claimed) {
      json(res, 409, { error: 'Taken' });
      return;
    }
    check.claimed = true;
    clearTimeout(check.timer);
    check.timer = setTimeout(() => endCheck(id, 504, { error: `The canvas didn't finish the check in ${CHECK_MS / 1000} s` }), CHECK_MS);
    json(res, 200, { ok: true });
  }

  async function finishCheck(id, req, res) {
    let report;
    try {
      report = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Not a report' });
      return;
    }
    if (!checks.get(id)?.claimed) {
      json(res, 404, { error: 'No such check' });
      return;
    }
    if (report.error) endCheck(id, 500, { error: `The canvas couldn't check the designs: ${report.error}` });
    else endCheck(id, 200, { dir: targetDir, root: rootDir, designs: Array.isArray(report.designs) ? report.designs : [] });
    res.writeHead(204).end();
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // API: checking the designs (htmlboard check), which the canvas does
    if (pathname === '/api/check' && req.method === 'GET') {
      startCheck(res, parsedUrl.searchParams.getAll('only'));
      return;
    }
    if (pathname.startsWith('/api/check/') && req.method === 'POST') {
      const [id, action, ...rest] = pathname.slice('/api/check/'.length).split('/');
      if (action === 'claim' && !rest.length) claimCheck(id, res);
      else if (action === undefined) finishCheck(id, req, res);
      else json(res, 404, { error: 'Not found' });
      return;
    }

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
    if (pathname === '/') {
      serveStaticFile(path.join(CLIENT_DIR, 'index.html'), req, res);
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
      serveStaticFile(clientFilePath, req, res);
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

    // The pages the canvas shows in frames get the probe (htmlboard check); a page opened on its own doesn't
    const framed = req.headers['sec-fetch-dest'] === 'iframe';

    // A component alone, as the canvas shows it (components/<tag>.html?preview): its example in a page
    if (parsedUrl.searchParams.has('preview')) {
      const preview = componentPreview(targetDir, filePath);
      if (preview !== null) {
        res.writeHead(200, {
          'Content-Type': MIME_TYPES['.html'],
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(framed ? withProbe(Buffer.from(preview)) : preview);
        return;
      }
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStaticFile(filePath, req, res, { probe: framed });
    } else if (pathname === '/index.html') {
      serveStaticFile(path.join(CLIENT_DIR, 'index.html'), req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`File not found: ${pathname}`);
    }
  });

  function serveStaticFile(filePath, req, res, { probe = false } = {}) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      // HEAD (htmlboard check asks which files are there) needs no reading
      let content = req.method === 'HEAD' ? null : fs.readFileSync(filePath);
      if (content && probe && (ext === '.html' || ext === '.htm')) content = withProbe(content);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      if (content) res.end(content);
      else res.end();
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
          send('change', {
            type: file === manifestFile ? 'manifest' : isFolder ? 'folder' : 'file',
            file,
            isHtml: !isFolder && /\.html?$/i.test(file),
            timestamp: Date.now()
          });
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
      for (const id of [...checks.keys()]) endCheck(id, 503, { error: 'htmlboard stopped' });
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
