import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// The htmlboard canvases running on this machine, found by asking ports for /api/health: for
// `htmlboard check` and `shot`, and so that starting htmlboard again for a folder points at the
// running one. With none running for them, check and shot start one of their own (withCanvas).

/** Where htmlboard listens unless told otherwise: 3000, or the next free port */
export const PORTS = Array.from({ length: 21 }, (_, i) => 3000 + i);

/**
 * GET a URL: its status and body. Its connection closes once answered: kept open (Node's default
 * since 19), the connections to the ports asked would keep a command from exiting for seconds.
 */
export function get(url, { timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (timeout) req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
  });
}

/**
 * The htmlboard servers listening on these ports: each its health (dir, root, version) with its
 * port and url.
 */
export async function findCanvases(ports = PORTS) {
  const found = await Promise.all([...new Set(ports)].map(async (port) => {
    try {
      const { status, body } = await get(`http://127.0.0.1:${port}/api/health`, { timeout: 1500 });
      const health = JSON.parse(body);
      return status === 200 && health.status === 'ok' && health.dir ? { ...health, port, url: `http://localhost:${port}` } : null;
    } catch {
      return null;
    }
  }));
  return found.filter(Boolean);
}

/** The canvas can't be asked (none running for the folder, none open in a browser): exit code 2 */
export class CanvasError extends Error {}

const isInside = (base, target) => {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * The canvas that shows a path (a designs folder, a folder in it, or a design's file): the one whose
 * folder holds it (the deepest), else the only one inside it. `only` is the path from its folder, ''
 * for all of it. Throws a CanvasError when there's none, or more than one to choose from.
 *
 * @param {string} [target] A path (default: the current folder)
 * @param {object} [options]
 * @param {number} [options.port] The canvas's port (default: looked for on 3000 to 3020)
 */
export async function canvasFor(target, { port } = {}) {
  const full = path.resolve(target || process.cwd());
  const canvases = await findCanvases(port ? [Number(port)] : PORTS);
  const holding = canvases.filter((canvas) => isInside(canvas.dir, full)).sort((a, b) => b.dir.length - a.dir.length);
  const within = canvases.filter((canvas) => isInside(full, canvas.dir));
  let canvas = holding[0] ?? (within.length === 1 ? within[0] : null);
  if (!canvas && port && !target && canvases.length) canvas = canvases[0];
  if (!canvas) {
    const shown = path.relative(process.cwd(), full) || '.';
    if (within.length > 1) {
      throw new CanvasError(`Several canvases show folders in ${shown}: ${within.map((c) => `${path.relative(process.cwd(), c.dir)} (${c.url})`).join(', ')}. Say which one.`);
    }
    if (port) throw new CanvasError(canvases.length ? `The canvas at ${canvases[0].url} shows ${canvases[0].dir}, not ${shown}.` : `No htmlboard is running at http://localhost:${port}.`);
    throw Object.assign(new CanvasError(`No htmlboard canvas is running for ${shown}. Start it (npx htmlboard <designs folder>) and open it in a browser.`), { none: true });
  }
  const only = holding[0] === canvas && full !== canvas.dir ? path.relative(canvas.dir, full).split(path.sep).join('/') : '';
  return { canvas, only };
}

/**
 * Ask a canvas's server (`/api/check?…`, `/api/shot?…`): its status and its answer's fields. `what`
 * says what was asked, for the errors: "the check".
 */
export async function askCanvas(canvas, request, what) {
  let answer;
  try {
    const { status, body } = await get(`http://127.0.0.1:${canvas.port}${request}`);
    answer = { status, ...JSON.parse(body) };
  } catch (error) {
    throw new CanvasError(`The canvas at ${canvas.url} didn't answer (${error.message}).`);
  }
  if (answer.status === 409) {
    if (answer.browser !== false) {
      throw new CanvasError(`The canvas at ${canvas.url} isn't open in a browser, and ${what} runs there. Open it and try again.`);
    }
    const none = `there's no browser to run ${what} in out of sight (Chrome, Chromium, Edge or Firefox; HTMLBOARD_BROWSER=<path> names another)`;
    throw new CanvasError(canvas.local
      ? `No htmlboard canvas is running for ${path.relative(process.cwd(), canvas.dir) || '.'}, and ${none}. Start it (npx htmlboard <designs folder>), open it in a browser and try again.`
      : `The canvas at ${canvas.url} isn't open in a browser, and ${none}. Open it and try again.`);
  }
  return answer;
}

// What a designs folder has at its top, and its sections don't
const DESIGNS_FOLDER_MARKS = ['designs.json', 'styles.css', 'components.js', 'components'];

/**
 * The designs folder a path is in, when no canvas says so: the nearest folder at or above it (not
 * above the current folder, when the path is in it) with what a designs folder has at its top; else
 * the path's own folder.
 */
export function designsFolderOf(target) {
  const full = path.resolve(target);
  const start = fs.statSync(full, { throwIfNoEntry: false })?.isDirectory() ? full : path.dirname(full);
  const stop = isInside(process.cwd(), start) ? process.cwd() : path.parse(start).root;
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (DESIGNS_FOLDER_MARKS.some((mark) => fs.existsSync(path.join(dir, mark)))) return dir;
    if (dir === stop || dir === path.dirname(dir)) return start;
  }
}

/**
 * Runs ask(canvas, only) with the canvas that shows `target` (see canvasFor). With none running for
 * it, one is started for the time of ask, in this process: for the designs folder the target is in,
 * served from `root` (default: that folder), opened out of sight. That canvas has `local: true`.
 *
 * @param {string} [target] A path (default: the current folder)
 * @param {{ port?: number, root?: string }} options
 * @param {(canvas: object, only: string) => Promise<any>} ask
 */
export async function withCanvas(target, { port, root } = {}, ask) {
  let found;
  try {
    found = await canvasFor(target, { port });
  } catch (error) {
    if (!error.none) throw error;
  }
  if (found) return ask(found.canvas, found.only);
  const full = path.resolve(target || process.cwd());
  const dir = designsFolderOf(full);
  const { startServer } = await import('./server.js');
  const local = await startServer({ dir, root: root ? path.resolve(root) : undefined, port: 0, host: '127.0.0.1', watch: false, quiet: true });
  try {
    const canvas = { port: local.port, url: local.url, dir: local.targetDir, root: local.rootDir, local: true };
    return await ask(canvas, path.relative(dir, full).split(path.sep).join('/'));
  } finally {
    await local.close();
  }
}
