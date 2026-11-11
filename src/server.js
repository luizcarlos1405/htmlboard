import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDesignsManifest } from './designs.js';
import { componentPreview } from './components.js';
import { findBrowser, launchBrowser } from './browser.js';
import { openPictures, pictureQueue, pictureKey, designKey, pictureParams, IMAGE_TYPES } from './pictures.js';

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
  if (res.headersSent || res.destroyed) return; // answered already, or the asker is gone
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
/** How long a page making pictures out of sight waits to be given one, before it asks again */
const PICTURE_WAIT_MS = 20000;
/** Pictures made at once out of sight: tabs of Chromium (Firefox makes as many in its one page) */
const PICTURE_MAKERS = Math.max(1, Math.min(4, (os.availableParallelism?.() ?? os.cpus().length) - 1));
/** The most a picture sent to be kept can weigh, as base64 */
const PICTURE_LIMIT = 32 * 1024 * 1024;
/** The browser out of sight quitting by itself while making pictures is opened again this many times in a row */
const PICTURE_RESTARTS = 2;
/** A browser that couldn't be opened to make pictures is tried again after this long */
const PICTURE_RETRY_MS = 10 * 60 * 1000;

/** True when target is base itself or inside it */
function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Which maker a page out of sight is (its ?maker=), or -1 */
function makerOf(url) {
  try {
    const params = new URL(url).searchParams;
    return params.has('worker') && params.has('maker') ? Number(params.get('maker')) : -1;
  } catch {
    return -1;
  }
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
      if (res.destroyed) {
        idleHeadless(); // the asker gave up meanwhile: the browser quits after a while
        return;
      }
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

  // askCanvas, for a request that is answered whatever goes wrong
  function asking(res, ...args) {
    askCanvas(res, ...args).catch((error) => json(res, 500, { error: String(error?.message || error) }));
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
      reply = null;
    }
    if (!reply || typeof reply !== 'object') {
      json(res, 400, { error: 'Not an answer' });
      return;
    }
    const request = requests.get(id);
    if (!request?.claimed) {
      json(res, 404, { error: 'No such request' });
      return;
    }
    let status;
    let body;
    try {
      ({ status, body } = request.answer(reply));
    } catch (error) {
      [status, body] = [500, { error: `The canvas's answer didn't make sense (${error.message})` }];
    }
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

  // What options.browser or findBrowser() gives, looked up once
  function browserFound() {
    if (headless.browser === undefined) headless.browser = options.browser !== undefined ? options.browser : findBrowser();
    return headless.browser;
  }

  function openHeadless() {
    headless.opening ||= (async () => {
      const browser = browserFound();
      if (!browser) {
        throw Object.assign(new Error("The canvas isn't open in a browser, and there's no browser to open it in out of sight"), { browser: false });
      }
      // Its first page also makes pictures (maker 0), as Chromium's other tabs do (see makePictures)
      const running = launchBrowser(browser, `http://127.0.0.1:${server.address().port}/?worker&maker=0&engine=${browser.engine}`);
      headless.running = running;
      running.exited.then(() => {
        if (headless.running !== running) return;
        headless.running = null; // quit by itself (a crash): its profile goes, and the next request opens another
        running.close();
        stopMakers();
        if (!pictures.queue.idle() && pictures.restarts++ < PICTURE_RESTARTS) makePictures();
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

  // Quits it after a while without requests, and with no pictures to make
  function idleHeadless() {
    clearTimeout(headless.idle);
    if (headless.running && !requests.size && !headless.opening && pictures.queue.idle()) headless.idle = setTimeout(closeHeadless, headless.idleMs);
  }

  function closeHeadless() {
    clearTimeout(headless.idle);
    const { running } = headless;
    headless.running = null;
    stopMakers();
    return running ? running.close() : Promise.resolve();
  }

  // Pictures of the designs, kept in the designs folder's .htmlboard/ (see pictures.js). The browser
  // out of sight makes them while a canvas asks for them, a few at once, so the canvas has nothing to
  // do but show them: Chromium takes screenshots of the pages (in PICTURE_MAKERS tabs), Firefox draws
  // them as the canvas would. With no browser, the canvas makes them itself and sends them to keep.
  const pictures = {
    store: null,
    queue: pictureQueue({ onChange: (progress) => progressOfPictures(progress) }),
    sessions: new Map(), // maker → its DevTools session (a promise), Chromium's tabs
    tabs: false, // Chromium's other tabs are open
    restarts: 0,
    failedAt: 0, // the browser couldn't be opened to make them: the canvases make them for a while
    progress: null,
    progressTimer: null,
  };
  const pictureStore = () => (pictures.store ||= openPictures(targetDir, rootDir));
  const describePicture = (picture) => ({ url: `/__pictures/${picture.image}`, height: picture.height, themes: picture.themes, fresh: picture.fresh });

  // The canvases hear how far the pictures have got (the toolbar says so), a few times a second at most
  function progressOfPictures(progress) {
    pictures.progress = progress;
    if (progress.done === progress.total) idleHeadless();
    if (pictures.progressTimer) return;
    pictures.progressTimer = setTimeout(() => {
      pictures.progressTimer = null;
      send('pictures', pictures.progress);
    }, 150);
  }

  // The browser out of sight quit: what its pages were making waits for the next one
  function stopMakers() {
    pictures.sessions.clear();
    pictures.tabs = false;
    pictures.queue.stopAll();
  }

  // The browser that makes the pictures out of sight, unless it couldn't be opened lately
  function pictureMaker() {
    const browser = browserFound();
    return browser && !(pictures.failedAt && Date.now() - pictures.failedAt < PICTURE_RETRY_MS) ? browser : null;
  }

  /** The pictures kept for the canvas's designs, in a theme, system mode and scale (see pictureParams) */
  function listPictures(asked) {
    const designs = canvasDesigns();
    const store = pictureStore();
    const shown = new Set(designs.map(designKey));
    store.prune((key) => shown.has(key));
    const found = store.find(designs.map((design) => pictureKey(design, asked)));
    const list = {};
    for (const design of designs) {
      const picture = found.get(pictureKey(design, asked));
      if (picture) list[designKey(design)] = describePicture(picture);
    }
    const browser = pictureMaker();
    return { maker: browser ? { name: browser.name, engine: browser.engine } : null, pictures: list, progress: pictures.queue.progress() };
  }

  /**
   * The canvas wants pictures of these designs (`designs`: their keys, the first first) in a theme,
   * system mode and scale: the ones not kept, or out of date, are made out of sight. Without a browser
   * to make them, `maker` is false and the canvas makes them itself.
   */
  function wantPictures(body) {
    if (!pictureMaker()) return { maker: false, queued: 0 };
    const asked = pictureParams(body);
    const byKey = new Map(canvasDesigns().map((design) => [designKey(design), design]));
    const designs = (Array.isArray(body.designs) ? body.designs : []).map((key) => byKey.get(String(key))).filter(Boolean);
    const found = pictureStore().find(designs.map((design) => pictureKey(design, asked)));
    const jobs = designs.filter((design) => !found.get(pictureKey(design, asked))?.fresh)
      .map((design) => ({ key: pictureKey(design, asked), design, ...asked }));
    const queued = pictures.queue.want(jobs);
    makePictures();
    return { maker: true, queued };
  }

  // Makes the pictures waiting: the browser out of sight opened if it isn't, with Chromium's other tabs
  function makePictures() {
    if (pictures.queue.idle()) return;
    clearTimeout(headless.idle);
    (async () => {
      if (!headless.running) await openHeadless();
      const running = headless.running;
      if (running?.cdp && !pictures.tabs) {
        pictures.tabs = true;
        const origin = `http://127.0.0.1:${server.address().port}`;
        for (let maker = 1; maker < PICTURE_MAKERS; maker++) {
          // Each in its own window: a tab behind another isn't drawn, and its pictures would wait forever
          await running.cdp.send('Target.createTarget', { url: `${origin}/?worker&maker=${maker}&engine=chromium&only=pictures`, newWindow: true }).catch(() => {});
        }
      }
    })().catch((error) => {
      // No browser can make them: the canvases make them themselves, for a while
      pictures.failedAt = Date.now();
      pictures.queue.clear();
      send('pictures', { done: 0, total: 0, maker: false, error: String(error?.message || error) });
    });
  }

  // A page out of sight asks for a picture to make: given one as soon as there is one
  async function givePicture(res) {
    const stop = new AbortController();
    res.on('close', () => stop.abort());
    const job = await pictures.queue.next(PICTURE_WAIT_MS, stop.signal);
    if (!job) {
      if (!res.destroyed) res.writeHead(204).end();
      return;
    }
    if (res.destroyed) {
      pictures.queue.giveBack(job);
      return;
    }
    pictures.restarts = 0;
    const { id, design, theme, scheme, scale } = job;
    json(res, 200, { id, design, theme, scheme, scale });
  }

  /** The files a page used (`urls`, as it loaded them), from the root, with the design's own */
  function filesOf(urls, file) {
    const files = new Set([String(file).split('?')[0]]);
    for (const url of Array.isArray(urls) ? urls : []) {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(String(url), 'http://localhost').pathname);
      } catch {
        continue;
      }
      const rel = pathname.replace(/^\/+/, '');
      if (!rel || /^(__explorer|__pictures|api)\//.test(rel) || !isInside(rootDir, path.join(rootDir, rel))) continue;
      files.add(rel);
    }
    return [...files];
  }

  /** Keeps a picture made of a job, and tells the canvases */
  function keepMade(job, report, image, type) {
    const picture = pictureStore().put(job.key, {
      height: report.height,
      themes: Array.isArray(report.themes) ? report.themes : [],
      files: filesOf(report.files, job.design.file),
      since: job.startedAt,
    }, image, type);
    pictures.queue.done(job.id, true, { fresh: picture.fresh });
    send('picture', { design: designKey(job.design), theme: job.theme, scheme: job.scheme, scale: job.scale, ...describePicture(picture) });
  }

  // A picture that couldn't be made: tried again, or given up on, and then the canvases show its page
  function pictureFailed(job, error) {
    const given = pictures.queue.done(job.id, false);
    if (given?.gaveUp) {
      send('picture', { design: designKey(job.design), theme: job.theme, scheme: job.scheme, scale: job.scale, failed: true, error: String(error?.message || error || 'unknown') });
    }
  }

  // Chromium's screenshot of the frame a maker (one of its tabs) has its design in, at the top left
  async function shoot(maker, job, report) {
    const cdp = headless.running?.cdp;
    if (!cdp) throw new Error('the browser out of sight has no DevTools pipe');
    if (!pictures.sessions.has(maker)) {
      const attaching = (async () => {
        const { targetInfos } = await cdp.send('Target.getTargets');
        const tab = targetInfos.find((info) => info.type === 'page' && makerOf(info.url) === maker);
        if (!tab) throw new Error(`no tab makes pictures as maker ${maker}`);
        return (await cdp.send('Target.attachToTarget', { targetId: tab.targetId, flatten: true })).sessionId;
      })();
      attaching.catch(() => pictures.sessions.delete(maker));
      pictures.sessions.set(maker, attaching);
    }
    const sessionId = await pictures.sessions.get(maker);
    const width = Math.max(1, Math.ceil(Number(report.width) || 1));
    const height = Math.max(1, Math.ceil(Number(report.height) || 1));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'webp', quality: 90, clip: { x: 0, y: 0, width, height, scale: job.scale }, fromSurface: true,
    }, sessionId);
    return Buffer.from(data, 'base64');
  }

  const readJson = async (req, limit) => {
    const value = JSON.parse(await readBody(req, limit));
    if (!value || typeof value !== 'object') throw new Error('Not JSON');
    return value;
  };

  // A maker's page is ready: its picture is taken (Chromium), or comes with it (Firefox, a canvas)
  async function takePicture(req, res, params) {
    let report;
    try {
      report = await readJson(req, PICTURE_LIMIT);
    } catch {
      json(res, 400, { error: 'Not a picture' });
      return;
    }
    const job = report.job ? pictures.queue.job(report.job) : null;
    if (params.has('shoot')) {
      if (!job) {
        json(res, 404, { error: 'No such picture to make' });
        return;
      }
      try {
        keepMade(job, report, await shoot(Number(params.get('maker')) || 0, job, report), 'image/webp');
      } catch (error) {
        pictureFailed(job, error);
        json(res, 500, { error: String(error?.message || error) });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }
    if (report.failed) {
      if (job) pictureFailed(job, report.failed);
      res.writeHead(204).end();
      return;
    }
    const type = Object.hasOwn(IMAGE_TYPES, report.type) ? report.type : null;
    const image = typeof report.image === 'string' ? Buffer.from(report.image, 'base64') : null;
    if (!type || !image?.length) {
      json(res, 400, { error: 'Not a picture' });
      return;
    }
    if (job) {
      keepMade(job, report, image, type);
    } else {
      // Made by a canvas, of a page it shows (no browser out of sight)
      const asked = pictureParams(report);
      const design = canvasDesigns().find((each) => designKey(each) === String(report.design));
      if (!design) {
        json(res, 404, { error: 'No such design on the canvas' });
        return;
      }
      const picture = pictureStore().put(pictureKey(design, asked), {
        height: report.height,
        themes: Array.isArray(report.themes) ? report.themes : [],
        files: filesOf(report.files, design.file),
        since: Number(report.since) || 0,
      }, image, type);
      send('picture', { design: designKey(design), ...asked, ...describePicture(picture) });
    }
    res.writeHead(204).end();
  }

  /**
   * The designs on the canvas, as the canvas needs them to load one afresh: with how their themes
   * apply when they or designs.json say (themes: { attribute, values })
   */
  function canvasDesigns() {
    const manifest = loadDesignsManifest(targetDir, rootDir);
    return manifest.sections
      .flatMap((section) => section.artboards)
      .map(({ id, file, title, width, height, fit, themes }) => ({ id, file, title, width, height, fit, themes: themes ?? manifest.themes }));
  }

  /** --theme and --themes, as the canvas takes them: a theme, or the themes to check each design in ('all', or a list) */
  function themesAsked(params) {
    const theme = params.get('theme')?.trim() || undefined;
    const themes = params.get('themes')?.trim();
    return {
      theme,
      themes: !themes ? undefined : themes === 'all' ? 'all' : themes.split(/[\s,]+/).filter(Boolean)
    };
  }

  /** A design's file from the designs folder ("01-shop/cart.html", with its query if it has one) */
  const ownFile = (file) => (designsPath ? file.slice(designsPath.length + 1) : file);

  // only: files or folders (from the designs folder) to check; all the designs when there's none.
  // theme, themes: the theme to check them in, or the themes to check each in (see themesAsked).
  function startCheck(res, only, { theme, themes } = {}) {
    const wanted = only.map((item) => item.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, ''));
    const designs = canvasDesigns().filter(({ file }) => {
      const own = ownFile(file).split('?')[0];
      return !wanted.length || wanted.some((item) => !item || own === item || own.startsWith(`${item}/`));
    });
    if (!designs.length) {
      json(res, 404, { error: wanted.some(Boolean) ? `No design on the canvas is in ${only.join(', ')}` : 'There are no designs to check' });
      return;
    }
    asking(res, 'check', { designs, theme, themes }, (report) => (report.error
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
    asking(res, 'shot', { design, selector: params.get('selector') || undefined, max: positive('max'), scale: positive('scale'), theme: themesAsked(params).theme },
      (shot) => {
        if (shot.error && shot.kind === 'request') return { status: 422, body: { error: shot.error } };
        if (shot.error || !shot.png) return { status: 500, body: { error: `The canvas couldn't shoot ${own}: ${shot.error || 'no image'}` } };
        return { status: 200, body: { file: own, title: design.title, width: shot.width, height: shot.height, matches: shot.matches, ...(shot.theme ? { theme: shot.theme } : {}), png: shot.png } };
      });
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(parsedUrl.pathname);

    // API: checking the designs (htmlboard check), which the canvas does
    if (pathname === '/api/check' && req.method === 'GET') {
      startCheck(res, parsedUrl.searchParams.getAll('only'), themesAsked(parsedUrl.searchParams));
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
      else finishRequest(answering[1], req, res).catch(() => json(res, 500, { error: "Couldn't take the answer" }));
      return;
    }

    // API: pictures of the designs, kept and made out of sight (see pictures.js)
    if (pathname === '/api/pictures' && req.method === 'GET') {
      try {
        json(res, 200, listPictures(pictureParams(Object.fromEntries(parsedUrl.searchParams))));
      } catch (error) {
        json(res, 500, { error: String(error?.message || error) });
      }
      return;
    }
    if (pathname === '/api/pictures/wanted' && req.method === 'POST') {
      readJson(req).then((body) => json(res, 200, wantPictures(body)), () => json(res, 400, { error: 'Say which pictures (JSON)' }))
        .catch((error) => json(res, 500, { error: String(error?.message || error) }));
      return;
    }
    if (pathname === '/api/pictures/next' && req.method === 'POST') {
      givePicture(res).catch(() => json(res, 500, { error: "Couldn't give a picture to make" }));
      return;
    }
    if (pathname === '/api/pictures' && req.method === 'POST') {
      takePicture(req, res, parsedUrl.searchParams).catch((error) => json(res, 500, { error: String(error?.message || error) }));
      return;
    }
    if (pathname.startsWith('/__pictures/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const file = pictureStore().imageFile(pathname.slice('/__pictures/'.length));
      if (!file || !isFile(file)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such picture');
        return;
      }
      // A picture made again gets another name: what's kept under one never changes
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
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
        pictures.queue.forgetFailures();
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
      clearTimeout(pictures.progressTimer);
      pictures.queue.clear();
      pictures.store?.flush();
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
