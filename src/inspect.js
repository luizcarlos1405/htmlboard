import { CanvasError, withCanvas, askCanvas } from './canvases.js';

// `htmlboard inspect`: a design's elements as rows of text, for an agent to read sizes, positions,
// gaps and what went wrong as numbers, and a design's structure without reading the whole file. The
// canvas running for the designs measures them in a browser (see client/inspect.js); as for the check
// and the shot, one out of sight when none is open, and with no canvas running, it starts one.

/** It can't be inspected as asked (a selector that matches nothing, a file that isn't a design): exit code 1 */
export class InspectError extends Error {}

/**
 * A design's elements, measured by the canvas that shows it.
 *
 * @param {string} file The design's file (a variant's with its query: `home.html?state=empty`)
 * @param {object} [options]
 * @param {string} [options.selector] That element (the first the CSS selector matches) and what's in it;
 *   without one, the page's outline: its landmarks, headings, tables and components
 * @param {string[]} [options.styles] Computed styles to give for each element: ['font-size', 'gap']
 * @param {number} [options.depth] Levels below the element (default 3)
 * @param {string} [options.theme] In this theme (see the canvas's theme switch)
 * @param {number} [options.port] The canvas's port (default: looked for on 3000 to 3020)
 * @param {string} [options.root] With no canvas running: the folder to serve files from, as --root
 * @returns {Promise<{canvas: object, inspection: {file: string, title: string, selector: ?string, width: number,
 *   height: number, matches: number, kind: 'element'|'outline'|'top', rows: object[], more: number}}>}
 *   The canvas, and each element's row: { depth, selector, x, y, width, height, text, problems, styles }
 */
export async function runInspect(file, { selector, styles, depth, theme, port, root } = {}) {
  if (!file) throw new InspectError('Say which design to inspect.');
  return withCanvas(file, { port, root }, async (canvas, only) => {
    if (!only) throw new InspectError(`${file} is the designs folder: say which design to inspect.`);
    const query = new URLSearchParams({ file: only });
    if (selector) query.set('selector', selector);
    if (styles?.length) query.set('styles', styles.join(','));
    if (depth !== undefined) query.set('depth', String(depth));
    if (theme) query.set('theme', theme);
    const answer = await askCanvas(canvas, `/api/inspect?${query}`, 'the inspection');
    if ([404, 422, 500].includes(answer.status)) throw new InspectError(`${answer.error}.`);
    if (answer.status !== 200) throw new CanvasError(`${answer.error || `The canvas answered ${answer.status}`}.`);
    const { status, ...inspection } = answer;
    return { canvas, inspection };
  });
}

/**
 * The rows as text: what was inspected, then a line per element, indented by its depth, with the
 * selector that finds it, its box (x,y width×height), its text, the styles asked for and what's wrong:
 *
 *   01-screens/02-customers.html · Customers (1280 × 820): .table
 *   .table  492,196 646×265  "Organization Plan Seats…"
 *     thead  492,196 646×33  "Organization Plan Seats MRR Status"
 *       th:nth-child(1)  492,196 198×33  "Organization"  font-size: 11px
 */
export function formatInspection({ file, title, width, height, selector, matches, kind, rows, more, theme }) {
  const what = kind === 'element'
    ? `${selector}${matches > 1 ? ` (the first of ${matches} matches)` : ''}`
    : kind === 'outline'
      ? 'its outline (landmarks, headings, tables, components)'
      : 'its first levels (it has no landmarks or headings to outline)';
  const lines = [`${file}${title && title !== file ? ` · ${title}` : ''} (${width} × ${height})${theme ? ` · ${theme}` : ''}: ${what}`];
  for (const row of rows) {
    const parts = [`${'  '.repeat(row.depth)}${row.selector}`, `${row.x},${row.y} ${row.width}×${row.height}`];
    if (row.text) parts.push(`"${row.text}"`);
    if (row.styles) parts.push(Object.entries(row.styles).map(([name, value]) => `${name}: ${value || '-'}`).join('; '));
    if (row.problems?.length) parts.push(`! ${row.problems.join('; ')}`);
    lines.push(parts.join('  '));
  }
  if (more) lines.push(`and ${more} more (a selector, or a smaller --depth, lists fewer)`);
  return `${lines.join('\n')}\n`;
}
