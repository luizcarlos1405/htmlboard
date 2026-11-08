import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CanvasError, withCanvas, askCanvas } from './canvases.js';

// `htmlboard shot`: a design, or one element of it, as a PNG an agent can look at. The canvas running
// for the designs draws it in a browser (see client/shot.js); this finds that canvas and asks it. As
// for the check, the canvas opens a browser out of sight when none is open, and with no canvas
// running, the shot starts one.

/** The shot couldn't be taken as asked (a selector that matches nothing, a file that isn't a design): exit code 1 */
export class ShotError extends Error {}

/**
 * A design as a PNG, drawn by the canvas that shows it.
 *
 * @param {string} file The design's file (a variant's with its query: `home.html?theme=dark`)
 * @param {object} [options]
 * @param {string} [options.selector] Only this element: the first one the CSS selector matches
 * @param {number} [options.max] The image's longest side at most this many px
 * @param {number} [options.scale] Image px per CSS px (default 1; not with max)
 * @param {number} [options.port] The canvas's port (default: looked for on 3000 to 3020)
 * @param {string} [options.root] With no canvas running: the folder to serve files from, as --root
 * @returns {Promise<{canvas: object, shot: {file: string, title: string, width: number, height: number, matches: number, png: Buffer}}>}
 *   The canvas (its url, dir, root; local: started for the shot) and the shot: its file from the
 *   designs folder, its size in px, how many elements the selector matched, the image, and the
 *   headless browser it was drawn in (browser), if it was.
 */
export async function runShot(file, { selector, max, scale, port, root } = {}) {
  if (!file) throw new ShotError('Say which design to shoot.');
  return withCanvas(file, { port, root }, async (canvas, only) => {
    if (!only) throw new ShotError(`${file} is the designs folder: say which design to shoot.`);
    const query = new URLSearchParams({ file: only });
    if (selector) query.set('selector', selector);
    if (max) query.set('max', String(max));
    if (scale) query.set('scale', String(scale));
    const answer = await askCanvas(canvas, `/api/shot?${query}`, 'the shot');
    if ([404, 422, 500].includes(answer.status)) throw new ShotError(`${answer.error}.`);
    if (answer.status !== 200) throw new CanvasError(`${answer.error || `The canvas answered ${answer.status}`}.`);
    const { status, png, ...shot } = answer;
    return { canvas, shot: { ...shot, png: Buffer.from(png, 'base64') } };
  });
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/**
 * Where a shot goes when it isn't told: the system's temporary folder, in a folder of the user's and
 * one for the designs folder (so that two projects' shots of `home.html` don't meet), named after
 * the design and the selector. A new shot of the same replaces it.
 *
 * @param {string} dir The designs folder
 * @param {string} file The design's file from it
 * @param {object} [options]
 * @param {string} [options.selector]
 */
export function shotPath(dir, file, { selector } = {}) {
  let user = 'user';
  try {
    user = os.userInfo().username || user;
  } catch {
    // No user name: shared
  }
  const project = `${slug(path.basename(dir)) || 'designs'}-${createHash('sha1').update(dir).digest('hex').slice(0, 6)}`;
  const name = slug(file.replace(/\.html?(?=$|\?)/i, '')) || 'design';
  return path.join(os.tmpdir(), `htmlboard-shots-${slug(user) || 'user'}`, project, `${name}${selector ? `--${slug(selector)}` : ''}.png`);
}
