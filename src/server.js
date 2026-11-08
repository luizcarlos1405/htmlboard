import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDesignsManifest } from './designs.js';
import { componentPreview } from './components.js';
import { findBrowser, launchBrowser } from './browser.js';

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

/** How long a canvas has to take a request (htmlboard check, shot), then to answer it */
const CLAIM_MS = 15000;
const ANSWER_MS = 180000;
/** The most a canvas's answer can weigh (a shot of a long page, as base64) */
const ANSWER_LIMIT = 256 * 1024 * 1024;
/** How long a browser opened out of sight has to open the canvas, and stays open without requests */
const HEADLESS_OPEN_MS = 30000;
const HEADLESS_IDLE_MS = 60000;

/** True when target is base itself or inside it */
function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** True when there is a file (not a folder) at filePath */
function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
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
 * Creates the HtmlBoard server (startServer() starts it).
 *
 * @param {object} [options]
 * @param {string} [options.dir] The designs folder (default: the current one)
 * @param {string} [options.root] The folder files are served from (default: the designs folder)
 * @param {boolean} [options.watch] Watch the files and push their changes to the canvas (default: true)
 * @param {object|null} [options.browser] The browser to open the canvas in out of sight when a
 *   request finds none open ({ path, name, engine }, see browser.js); null for none (default: found)
 * @param {number} [options.headlessIdleMs] How long that browser stays open without requests
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

  // Requests to the canvas: checks (htmlboard check), shots (htmlboard shot). Each goes to the
  // canvases open in a browser over the live reload events, as an event of its kind; the first to
  // claim it does it, and what it posts back answers the request.
  const requests = new Map(); // id → { res, kind, answer, claimed, headless, timer }

  function endRequest(id, status, body) {
    const request = requests.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    requests.delete(id);
    json(request.res, status, body);
    idleHeadless();
  }

  /**
   * Ask the canvas to do something: `payload` goes to it as a `kind` event, and `res` gets what
   * answer(reply) makes of its reply: `{ status, body }`. With no canvas open in a browser, the
   * server opens one out of sight first.
   */
  async function askCanvas(res, kind, payload, answer) {
    clearTimeout(headless.idle);
    if (!clients.size) {
      try {
        await openHeadless();
      } catch (error) {
        json(res, error.browser === false ? 409 : 503, { error: error.message, ...(error.browser === false ? { browser: false } : {}) });
        idleHeadless();
        return;
      }
      if (res.destroyed) return; // the asker gave up meanwhile
    }
    const id = randomUUID();
    const request = {
      res,
      kind,
      answer,
      claimed: false,
      timer: setTimeout(() => endRequest(id, 504, { error: `The canvas didn't take the ${kind} (reload it in the browser)` }), CLAIM_MS)
    };
    requests.set(id, request);
    res.on('close', () => {
      if (requests.get(id) !== request) return; // answered
      clearTimeout(request.timer);
      requests.delete(id);
      idleHeadless();
    });
    send(kind, { id, ...payload });
  }

  // headless: the canvas claiming is the one the server opened out of sight
  function claimRequest(id, res, { headless: hidden = false } = {}) {
    const request = requests.get(id);
    if (!request || request.claimed) {
      json(res, 409, { error: 'Taken' });
      return;
    }
    request.claimed = true;
    request.headless = hidden;
    clearTimeout(request.timer);
    request.timer = setTimeout(() => endRequest(id, 504, { error: `The canvas didn't finish the ${request.kind} in ${ANSWER_MS / 1000} s` }), ANSWER_MS);
    json(res, 200, { ok: true });
  }

  async function finishRequest(id, req, res) {
    let reply;
    try {
      reply = JSON.parse(await readBody(req, ANSWER_LIMIT));
    } catch {
      json(res, 400, { error: 'Not an answer' });
      return;
    }
    const request = requests.get(id);
    if (!request?.claimed) {
      json(res, 404, { error: 'No such request' });
      return;
    }
    const { status, body } = request.answer(reply);
    // Done out of sight: in which browser
    endRequest(id, status, request.headless && status === 200 && headless.browser ? { ...body, browser: headless.browser.name } : body);
    res.writeHead(204).end();
  }

  // A canvas out of sight: with none open in a browser, a request opens the canvas in a headless
  // browser (see browser.js), which stays open for the next ones and quits after a while without.
  const headless = {
    browser: undefined, // what options.browser or findBrowser() gives, looked up once
    running: null, // the browser, open
    opening: null, // a promise, until it has connected
    idle: 0,
    waiting: new Set(), // resolves the ones waiting for a canvas to connect
    idleMs: options.headlessIdleMs ?? HEADLESS_IDLE_MS
  };

  function openHeadless() {
    headless.opening ||= (async () => {
      if (headless.browser === undefined) headless.browser = options.browser !== undefined ? options.browser : findBrowser();
      const { browser } = headless;
      if (!browser) {
        throw Object.assign(new Error("The canvas isn't open in a browser, and there's no browser to open it in out of sight"), { browser: false });
      }
      const running = launchBrowser(browser, `http://127.0.0.1:${server.address().port}/?worker`);
      headless.running = running;
      running.exited.then(() => {
        if (headless.running !== running) return;
        headless.running = null; // quit by itself (a crash): its profile goes, and the next request opens another
        running.close();
      });
      let timer;
      try {
        await Promise.race([
          new Promise((resolve) => headless.waiting.add(resolve)),
          running.exited.then(({ error, code, signal }) => {
            throw new Error(`${browser.name} couldn't open the canvas (${error?.message || (signal ? `stopped by ${signal}` : `exit code ${code}`)})`);
          }),
          new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`${browser.name} didn't open the canvas in ${HEADLESS_OPEN_MS / 1000} s`)), HEADLESS_OPEN_MS);
          })
        ]);
      } catch (error) {
        headless.waiting.clear();
        closeHeadless();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      headless.opening = null;
    });
    return headless.opening;
  }

  // Quits it after a while without requests
  function idleHeadless() {
    clearTimeout(headless.idle);
    if (headless.running && !requests.size && !headless.opening) headless.idle = setTimeout(closeHeadless, headless.idleMs);
  }

  function closeHeadless() {
    clearTimeout(headless.idle);
    const { running } = headless;
    headless.running = null;
    return running ? running.close() : Promise.resolve();
  }

  /** The designs on the canvas, as the canvas needs them to load one afresh */
  function canvasDesigns() {
    return loadDesignsManifest(targetDir, rootDir).sections
      .flatMap((section) => section.artboards)
      .map(({ id, file, title, width, height, fit }) => ({ id, file, title, width, height, fit }));
  }

  /** A design's file from the designs folder ("01-shop/cart.html", with its query if it has one) */
  const ownFile = (file) => (designsPath ? file.slice(designsPath.length + 1) : file);

  // only: files or folders (from the designs folder) to check; all the designs when there's none
  function startCheck(res, only) {
    const wanted = only.map((item) => item.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, ''));
    const designs = canvasDesigns().filter(({ file }) => {
      const own = ownFile(file).split('?')[0];
      return !wanted.length || wanted.some((item) => !item || own === item || own.startsWith(`${item}/`));
    });
    if (!designs.length) {
      json(res, 404, { error: wanted.some(Boolean) ? `No design on the canvas is in ${only.join(', ')}` : 'There are no designs to check' });
      return;
    }
    askCanvas(res, 'check', { designs }, (report) => (report.error
      ? { status: 500, body: { error: `The canvas couldn't check the designs: ${report.error}` } }
      : { status: 200, body: { dir: targetDir, root: rootDir, designs: Array.isArray(report.designs) ? report.designs : [] } }));
  }

  // file: a design's file from the designs folder (a variant's with its query); selector, max and
  // scale as client/shot.js takes them. The PNG comes back as base64.
  function startShot(res, params) {
    const wanted = (params.get('file') || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
    const designs = canvasDesigns();
    const design = designs.find(({ file }) => ownFile(file) === wanted)
      || designs.find(({ file }) => ownFile(file).split('?')[0] === wanted);
    if (!design) {
      json(res, 404, { error: wanted ? `No design on the canvas is ${wanted}` : 'Say which design to shoot (?file=…)' });
      return;
    }
    const positive = (name) => {
      const value = Number(params.get(name));
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const own = ownFile(design.file);
    askCanvas(res, 'shot', { design, selector: params.get('selector') || undefined, max: positive('max'), scale: positive('scale') },
      (shot) => {
        if (shot.error && shot.kind === 'request') return { status: 422, body: { error: shot.error } };
        if (shot.error || !shot.png) return { status: 500, body: { error: `The canvas couldn't shoot ${own}: ${shot.error || 'no image'}` } };
        return { status: 200, body: { file: own, title: design.title, width: shot.width, height: shot.height, matches: shot.matches, png: shot.png } };
      });
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // API: checking the designs (htmlboard check), which the canvas does
    if (pathname === '/api/check' && req.method === 'GET') {
      startCheck(res, parsedUrl.searchParams.getAll('only'));
      return;
    }
    // API: a design, or an element of it, as a PNG (htmlboard shot), which the canvas draws
    if (pathname === '/api/shot' && req.method === 'GET') {
      startShot(res, parsedUrl.searchParams);
      return;
    }
    // The canvas claims a request, then answers it (at /api/check/…, a canvas from before shots)
    const answering = pathname.match(/^\/api\/(?:requests|check)\/([^/]+)(\/claim)?$/);
    if (answering && req.method === 'POST') {
      if (answering[2]) claimRequest(answering[1], res, { headless: parsedUrl.searchParams.has('headless') });
      else finishRequest(answering[1], req, res);
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
      for (const resolve of headless.waiting) resolve(); // requests waiting for a canvas
      headless.waiting.clear();

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

    // The explorer is at /, and at /index.html unless the served folder has an index.html of its
    // own (a project's page, which designs can load), served then like any other file
    if (pathname === '/' || (pathname === '/index.html' && !isFile(path.join(rootDir, 'index.html')))) {
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

    if (isFile(filePath)) {
      serveStaticFile(filePath, req, res, { probe: framed });
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

  // A server for one command (watch: false) sees the files as they are: nothing to reload
  if (options.watch !== false) {
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
  }

  return {
    server,
    targetDir,
    rootDir,
    close: async () => {
      clearTimeout(watchDebounceTimer);
      if (stopWatching) stopWatching();
      for (const id of [...requests.keys()]) endRequest(id, 503, { error: 'htmlboard stopped' });
      await closeHeadless();
      for (const client of clients) {
        client.end();
      }
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

/**
 * Starts the server (createServer's options) on `port`, or the next free one after it (default
 * 3000); port 0 takes any free one. `host`: the address it listens on (default: all of them);
 * `quiet`: no word about a busy port.
 */
export async function startServer(options = {}) {
  // Port 0: any free one, picked by the system (a canvas for one command, which nobody looks for)
  const requestedPort = options.port === 0 ? 0 : parseInt(options.port, 10) || 3000;
  const actualPort = requestedPort === 0 ? 0 : await findAvailablePort(requestedPort);

  if (actualPort !== requestedPort && !options.quiet) {
    console.log(`[htmlboard] Port ${requestedPort} is in use, using ${actualPort}...`);
  }

  const { server, targetDir, rootDir, close } = createServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(actualPort, options.host, () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        url: `http://localhost:${port}`,
        targetDir,
        rootDir,
        close
      });
    });
  });
}
