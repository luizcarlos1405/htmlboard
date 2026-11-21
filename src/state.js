import { CanvasError, canvasFor, get } from './canvases.js';

// `htmlboard state`: what the canvas running for the designs shows in the browser, so that an agent
// knows what the person means by "this": the design selected, the element picked in it, the theme,
// the filter and the search. Each canvas open in a browser tells its server when that changes; with
// several open, the one used last answers. Unlike check and shot, it starts no canvas: only one the
// person has open can say what they're looking at.

/**
 * What the canvas that shows `target` shows in the browser.
 *
 * @param {string} [target] A designs folder, a folder in it or a design's file (default: the current folder)
 * @param {object} [options]
 * @param {number} [options.port] The canvas's port (default: looked for on 3000 to 3020)
 * @returns {Promise<{canvas: object, open: number, state: {selected: ?{file: string, title: ?string, width: ?number,
 *   height: ?number}, element: ?{selector: string, text: ?string}, theme: ?string, filter: ?string, search: ?string}}>}
 *   The canvas (its url, dir, root), how many tabs have it open, and what the one used last shows
 *   (selected.file: from the designs folder)
 */
export async function readState(target, { port } = {}) {
  const { canvas } = await canvasFor(target, { port });
  let status;
  let answer;
  try {
    ({ status, body: answer } = await get(`http://127.0.0.1:${canvas.port}/api/state`));
    answer = status === 200 ? JSON.parse(answer) : null;
  } catch (error) {
    throw new CanvasError(`The canvas at ${canvas.url} didn't answer (${error.message}).`);
  }
  if (!answer) {
    throw new CanvasError(status === 404
      ? `The canvas at ${canvas.url} is htmlboard ${canvas.version}, which doesn't say what it shows: start it again with this one.`
      : `The canvas at ${canvas.url} answered ${status}.`);
  }
  if (!answer.state) {
    throw new CanvasError(answer.open
      ? `The canvas at ${canvas.url} hasn't said what it shows yet: try again in a moment, or reload it in the browser.`
      : `The canvas at ${canvas.url} isn't open in a browser, so nothing is selected.`);
  }
  return { canvas, open: answer.open, state: answer.state };
}

/**
 * What the canvas shows, in a few lines:
 *
 *   selected: 01-screens/02-customers.html (1440 × 900) · dark
 *   element: .table tr:nth-child(3) .badge "One-time"
 *   filter: desktop · search: "invoice"
 */
export function formatState({ selected, element, theme, filter, search }, { open = 1 } = {}) {
  const lines = [];
  if (selected) {
    const size = selected.width && selected.height ? ` (${selected.width} × ${selected.height})` : '';
    lines.push(`selected: ${selected.file}${size}${theme ? ` · ${theme}` : ''}`);
  } else {
    lines.push('selected: nothing');
    if (theme) lines.push(`theme: ${theme}`);
  }
  if (element) lines.push(`element: ${element.selector}${element.text ? ` "${element.text}"` : ''}`);
  const narrowed = [filter && `filter: ${filter}`, search && `search: "${search}"`].filter(Boolean);
  if (narrowed.length) lines.push(narrowed.join(' · '));
  if (open > 1) lines.push(`(${open} tabs have the canvas open: this is the one used last)`);
  return `${lines.join('\n')}\n`;
}
