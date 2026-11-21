// Inspecting a design (`htmlboard inspect`): its elements as rows of text, so an agent reads the
// numbers instead of an image. Each row is an element: the selector that finds it, its box (where it
// is and its size, in the page's px), a bit of its text, what went wrong with it as the check finds it
// (cut off, spilling out, past the frame's edge, low contrast) and the computed styles asked for. With a selector,
// that element and what's in it, a few levels deep; without one, the page's outline: its landmarks,
// headings, tables and components. The design loads afresh, out of sight, as for a shot.

import { hiddenBox, layoutProblems, lowContrast, measurer, openDesign } from './check.js';
import { shownRatio } from './contrast.js';
import { selectorOf, textOf } from './elements.js';
import { themeFor } from './theme.js';

const DEFAULT_SIZE = [1200, 800]; // as the canvas: a design whose entry gives no size
const FIT_HEIGHT = 100; // a frame that fits its page however short (a component's) starts this tall
const MOST = 60; // rows at most: the rest are counted
const DEPTH = 3; // levels below the element asked for
const TOP = 2; // levels below the body, for a page with no outline to speak of
const OUTLINE = [
  'header', 'nav', 'main', 'aside', 'footer', 'section', 'article', 'form', 'dialog', 'table',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="banner"]', '[role="navigation"]', '[role="main"]',
  '[role="complementary"]', '[role="contentinfo"]', '[role="region"]', '[role="dialog"]', '[role="search"]',
].join(', ');
const NOT_SHOWN = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'base', 'br', 'wbr']);

/** What the agent asked for can't be inspected (a selector that matches nothing): not the canvas's fault */
export class InspectError extends Error {}

/**
 * A design's elements: `{ width, height, matches, kind, rows, more }` (matches: how many elements the
 * selector matched, the first inspected; kind: 'element', 'outline', or 'top' for a page with no
 * outline, whose first levels are listed instead; more: the rows past the most listed).
 *
 * @param {object} request
 * @param {{ file: string, width?: number, height?: number, fit?: boolean, themes?: object }} request.design
 * @param {string} [request.selector] That element and what's in it
 * @param {string[]} [request.styles] Computed styles to give for each element (font-size, gap, color)
 * @param {number} [request.depth] Levels below the element (default 3)
 * @param {string} [request.theme] The theme to show it in (see theme.js); default: the page's own
 */
export async function inspectDesign({ design, selector, styles = [], depth = DEPTH, theme }) {
  const width = Number(design.width) || DEFAULT_SIZE[0];
  const height = Number(design.height) || 0;
  const box = hiddenBox();
  try {
    const page = await openDesign({
      file: design.file,
      width,
      height,
      frameHeight: height || (design.fit ? FIT_HEIGHT : DEFAULT_SIZE[1]),
    }, box, { grow: true, theme: themeFor(design.themes, theme) });
    if (!page.doc) throw new Error('the page shows nothing');
    const { win, doc } = page;
    let matches = 0;
    let kind = 'element';
    let elements; // [el, level], in the page's order
    if (selector) {
      let found;
      try {
        found = doc.querySelectorAll(selector);
      } catch {
        throw new InspectError(`${selector} isn't a CSS selector`);
      }
      matches = found.length;
      if (!matches) throw new InspectError(`nothing in the page matches ${selector}`);
      elements = levels(found[0], Number.isInteger(depth) && depth >= 0 ? depth : DEPTH);
    } else {
      kind = 'outline';
      elements = outline(doc);
      if (elements.length < 3) {
        kind = 'top';
        elements = levels(doc.body, TOP).slice(1).map(([el, level]) => [el, level - 1]);
      }
    }
    const marks = problemsByElement(win, doc);
    const rows = elements.slice(0, MOST).map(([el, level]) => row(win, el, level, marks, styles));
    return {
      width,
      height: parseFloat(page.frame.style.height),
      matches,
      kind,
      rows,
      more: Math.max(0, elements.length - MOST),
      ...(theme ? { theme } : {}),
    };
  } finally {
    box.remove();
  }
}

const shown = (el) => !NOT_SHOWN.has(el.localName) && el.getClientRects().length > 0;

/** An element and what's in it that shows, `depth` levels down */
function levels(root, depth) {
  const found = [[root, 0]];
  const visit = (el, level) => {
    if (level > depth) return;
    for (const child of el.children) {
      if (!shown(child)) continue;
      found.push([child, level]);
      visit(child, level + 1);
    }
  };
  visit(root, 1);
  return found;
}

/** The page's landmarks, headings, tables and components that show, each as deep as those around it */
function outline(doc) {
  const marked = [...doc.body.querySelectorAll('*')].filter((el) => (el.matches(OUTLINE) || el.localName.includes('-')) && shown(el));
  const inside = new Set(marked);
  return marked.map((el) => {
    let level = 0;
    for (let up = el.parentElement; up && up !== doc.body; up = up.parentElement) if (inside.has(up)) level++;
    return [el, level];
  });
}

/** What the check finds wrong in the page's layout and contrast, by the element it's about */
function problemsByElement(win, doc) {
  const measures = measurer(win, doc);
  const { beyond, cut, spilled } = layoutProblems(win, doc, measures);
  const { low } = lowContrast(win, doc, measures);
  const marks = new Map();
  const add = (el, problem) => {
    if (!marks.has(el)) marks.set(el, []);
    marks.get(el).push(problem);
  };
  for (const { el, right } of beyond) add(el, `past the right edge (to ${right})`);
  for (const [el, { overflow }] of cut) add(el, `cuts text off (overflow: ${overflow})`);
  for (const el of spilled.keys()) add(el, 'text spills out');
  for (const { el, ratio, needs, color, background } of low) add(el, `contrast ${shownRatio(ratio)}:1, needs ${needs} (${color} on ${background})`);
  return marks;
}

function row(win, el, level, marks, styles) {
  const box = el.getBoundingClientRect();
  const computed = styles.length ? win.getComputedStyle(el) : null;
  return {
    depth: level,
    selector: selectorOf(el),
    x: Math.round(box.left),
    y: Math.round(box.top),
    width: Math.round(box.width),
    height: Math.round(box.height),
    text: textOf(el),
    problems: marks.get(el) || [],
    ...(computed ? { styles: Object.fromEntries(styles.map((name) => [name, computed.getPropertyValue(name)])) } : {}),
  };
}
