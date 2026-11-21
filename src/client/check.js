// Checking the designs (`htmlboard check`). Each design loads afresh, out of sight, in a frame of its
// size, so the check sees the files as they are now, whatever the canvas shows (a filter, a reload
// on its way). Once its page settles, the check reads what went wrong:
//
//   - what the probe noted while the page built (probe.js, which the server puts in framed pages):
//     script errors, console.error, files that didn't load;
//   - files the page asked for that aren't there (a stylesheet's fonts and images too), and icons
//     drawn from a sprite (<use href="icons.svg#name">) that it doesn't have;
//   - components that weren't built, fonts that didn't load, a page that shows nothing;
//   - layout: content cut at the frame's right edge, or below a frame of fixed height; text cut off
//     by a box that hides what overflows it; text spilling out of its box;
//   - text whose colour is too close to its background's (WCAG AA), as a note: faint text can be meant.
//
// What a design means to do is left alone: text that ends in an ellipsis or is clamped, boxes that
// scroll, content hidden or moved off the page on purpose.

import { contrastRatio, hex, needs, over, shownRatio } from './contrast.js';
import { themeFor, showTheme, setTheme, themesOf, inOrder } from './theme.js';

const AT_ONCE = 4; // designs loading at the same time
const LOAD_MS = 10000; // a page that hasn't loaded by then is checked as it is, and said so
const QUIET_MS = 300; // a page whose content hasn't changed for this long has settled…
const SETTLE_MS = 3000; // …or this long after it loaded, if it keeps changing
const MOST = 5; // boxes listed for a layout problem; the rest are counted

const MEDIA = 'img, svg, video, canvas, picture, iframe, embed, object, input, select, textarea, button';
const NOT_TEXT = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'option', 'title']);
const PICTURES = new Set(['img', 'svg', 'video', 'canvas', 'picture', 'iframe', 'embed', 'object']);
const CLIPS = new Set(['hidden', 'clip']);
const SCROLLS = new Set(['auto', 'scroll']);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A box out of sight, for the frames that load designs afresh; the caller removes it */
export function hiddenBox() {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none;';
  document.body.append(box);
  return box;
}

/**
 * A design's page loaded afresh in a frame of its size in `box`, once it has settled: the frame,
 * its window and document (none when there's no page to see), and whether it finished loading in
 * time. With `grow`, a design without a height of its own gets a frame as tall as its page, as the
 * canvas shows it. `theme`: the theme to show it in (see theme.js); without one, the page's own, in
 * the system's light mode (the same whatever the person's computer is set to), or the one `own` says
 * (a picture for a canvas on a computer set to dark). The caller removes the frame.
 *
 * @param {{ file: string, width: number, height?: number, frameHeight: number }} design
 */
export async function openDesign(design, box, { grow = false, theme = null, own = 'light' } = {}) {
  const frame = document.createElement('iframe');
  frame.name = 'htmlboard-check'; // the probe listens in these frames only
  frame.setAttribute('scrolling', 'no');
  frame.style.cssText = `position: absolute; left: 0; top: 0; border: 0; width: ${design.width}px; height: ${design.frameHeight}px;`;
  showTheme(frame, theme, { own });
  const loaded = new Promise((resolve) => frame.addEventListener('load', () => resolve(true), { once: true }));
  frame.src = encodeURI(`/${design.file}`);
  box.append(frame);
  const finished = await Promise.race([loaded, wait(LOAD_MS).then(() => false)]);
  const doc = frame.contentDocument;
  if (!doc?.body) return { frame, finished, win: null, doc: null };
  if (theme) setTheme(doc.documentElement, theme); // again, in case the page's scripts set their own
  if (finished) await settle(doc);
  if (grow && !design.height) {
    // Measured once: a page always a bit taller than its frame would grow forever
    const tall = Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight));
    if (tall > design.frameHeight) {
      frame.style.height = `${tall}px`;
      await settle(doc); // a page that lays itself out again at its new size (no animation frame: the frame isn't drawn)
    }
  }
  return { frame, finished, win: frame.contentWindow, doc };
}

/**
 * Check designs, each `{ file, title, width, height, frameHeight, grow, themes }` (height: the
 * design's own, 0 when it grows with its page; frameHeight: its frame's; grow: to its page's height,
 * when the canvas hasn't measured it; themes: how its themes apply, when it says), and say what went
 * wrong in each.
 *
 * In a theme (`theme`), or in several (`themes`: 'all', its default and every theme it has, or a
 * list): a problem found in some of them only says which (`themes` on it), and each design says the
 * themes it was checked in.
 */
export async function checkDesigns(designs, { theme = null, themes = null } = {}) {
  const box = hiddenBox();
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < designs.length) {
      const index = next++;
      results[index] = await checkInThemes(designs[index], box, { theme, themes });
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, designs.length) }, worker));
  } finally {
    box.remove();
  }
  await findMissing(results);
  await findMissingIcons(results);
  return results.map(({ resources, icons, found, ...result }) => result);
}

// A design in a theme, or in each of several, its problems in them merged
async function checkInThemes(design, box, { theme, themes }) {
  const config = design.themes;
  if (!themes) {
    const result = await checkDesign(design, box, { theme: themeFor(config, theme) });
    return theme ? { ...result, themes: [theme] } : result;
  }
  const runs = [];
  let values = themes;
  if (themes === 'all') {
    // Its default first, where the themes its stylesheets have are found when it doesn't say
    const first = await checkDesign(design, box, { find: config?.values?.length ? null : config?.attribute || 'data-theme' });
    runs.push(['default', first]);
    values = config?.values?.length ? config.values : first.found;
  }
  for (const value of inOrder(values || [])) runs.push([value, await checkDesign(design, box, { theme: themeFor(config, value) })]);
  if (runs.length === 1) return runs[0][1]; // no themes: as without --themes
  return merge(runs);
}

// Runs of one design in several themes as one result: a problem found in all of them once, the others
// with the themes they were found in
function merge(runs) {
  const result = { ...runs[0][1], problems: [], resources: new Map(), icons: new Map(), themes: runs.map(([label]) => label) };
  delete result.found;
  const seen = new Map(); // problem as JSON → { problem, labels }
  for (const [label, run] of runs) {
    for (const [file, code] of run.resources) if (code || !result.resources.has(file)) result.resources.set(file, code);
    for (const [file, ids] of run.icons) if (!result.icons.has(file)) result.icons.set(file, ids);
    for (const problem of run.problems) {
      const key = JSON.stringify(problem);
      if (!seen.has(key)) seen.set(key, { problem, labels: [] });
      seen.get(key).labels.push(label);
    }
  }
  for (const { problem, labels } of seen.values()) {
    result.problems.push(labels.length === runs.length ? problem : { ...problem, themes: labels });
  }
  return result;
}

// find: the attribute to find the page's themes for (in `found`)
async function checkDesign(design, box, { theme = null, find = null } = {}) {
  const result = {
    file: design.file, title: design.title, width: design.width, height: design.height || null,
    problems: [], resources: new Map(), icons: new Map(),
  };
  let frame;
  try {
    const page = await openDesign(design, box, { grow: design.grow, theme });
    frame = page.frame;
    if (!page.doc) {
      result.problems.push({ level: 'error', kind: 'blank' });
      return result;
    }
    if (find) result.found = themesOf(page.doc, find);
    if (!page.finished) result.problems.push({ level: 'error', kind: 'timeout', seconds: LOAD_MS / 1000 });
    readProblems(page.win, page.doc, design, result);
  } catch (error) {
    result.problems.push({ level: 'error', kind: 'check', message: String(error?.message || error) });
  } finally {
    frame?.remove();
  }
  return result;
}

// Fonts in, components built, scripts done changing the page: quiet for QUIET_MS, or SETTLE_MS
async function settle(doc) {
  const start = performance.now();
  await Promise.race([doc.fonts?.ready, wait(SETTLE_MS)]);
  await new Promise((resolve) => {
    let quiet = 0;
    let cap = 0;
    const observer = new doc.defaultView.MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(done, QUIET_MS);
    });
    function done() {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      resolve();
    }
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    quiet = setTimeout(done, QUIET_MS);
    cap = setTimeout(done, Math.max(QUIET_MS, SETTLE_MS - (performance.now() - start)));
  });
  await Promise.race([doc.fonts?.ready, wait(SETTLE_MS)]); // the fonts the new content asked for
}

/** A same-origin URL as its path from the server's root (`{ path: "/01-screens/app.js" }`), any other as it is */
function where(url) {
  try {
    const parsed = new URL(url, location.href);
    return parsed.origin === location.origin ? { path: decodeURIComponent(parsed.pathname) } : { url: parsed.href };
  } catch {
    return { url: String(url) };
  }
}

// The same problem again and again (an error in a loop) is listed once, with how many times
function addCounted(problems, problem) {
  const key = JSON.stringify(problem);
  const same = problems.find((other) => other.key === key);
  if (same) same.count = (same.count || 1) + 1;
  else problems.push(Object.defineProperty({ ...problem }, 'key', { value: key }));
}

/** A page's measures, each taken once: an element's computed style, its box, whether it's hidden */
export function measurer(win, doc) {
  const cache = (measure) => {
    const known = new Map();
    return (el) => {
      if (!known.has(el)) known.set(el, measure(el));
      return known.get(el);
    };
  };
  const style = cache((el) => win.getComputedStyle(el));
  const rect = cache((el) => el.getBoundingClientRect());
  const hidden = cache((el) => {
    const own = style(el);
    return own.visibility !== 'visible' || own.opacity === '0'
      || Boolean(el.parentElement && el.parentElement !== doc.documentElement && hidden(el.parentElement));
  });
  // A box that hides or scrolls what overflows it
  const keeps = (el) => style(el).overflowX !== 'visible' || style(el).overflowY !== 'visible';
  return { style, rect, hidden, keeps };
}

function readProblems(win, doc, design, { problems, resources, icons }) {
  const body = doc.body;
  const measures = measurer(win, doc);
  const { rect, hidden } = measures;

  // What the probe noted while the page built
  const loads = new Set();
  for (const note of win.__htmlboard?.problems ?? []) {
    if (note.kind === 'script') {
      const source = note.source ? { source: where(note.source).path ?? note.source, line: note.line } : {};
      addCounted(problems, { level: 'error', kind: 'script', message: note.message, ...source });
    } else if (note.kind === 'console') {
      addCounted(problems, { level: 'error', kind: 'console', message: note.message });
    } else if (note.kind === 'load') {
      loads.add(note.url);
      addCounted(problems, { level: 'error', kind: 'load', tag: note.tag, ...(note.url ? where(note.url) : {}) });
    }
  }

  // Images that didn't load, if the probe didn't hear of them
  for (const img of doc.images) {
    const src = img.currentSrc || img.src;
    if (img.complete && !img.naturalWidth && src && !loads.has(src)) {
      loads.add(src);
      addCounted(problems, { level: 'error', kind: 'load', tag: 'img', ...where(src) });
    }
  }

  // Elements of tags nobody defined: components with no file, or a page that doesn't load components.js
  const tags = new Set([...doc.querySelectorAll(':not(:defined)')].map((el) => el.localName).filter((name) => name.includes('-')));
  if (tags.size) {
    const loader = [...doc.querySelectorAll('script[src]')]
      .find((script) => /(^|\/)components\.js$/.test(new URL(script.src, doc.baseURI).pathname));
    for (const tag of tags) {
      problems.push(loader
        ? { level: 'error', kind: 'component', tag, ...where(new URL(`components/${tag}.html`, loader.src)) }
        : { level: 'error', kind: 'component', tag, loader: false });
    }
  }

  // Fonts the page uses that didn't load
  const families = new Set();
  for (const face of doc.fonts ?? []) if (face.status === 'error') families.add(face.family.replace(/^(["'])(.*)\1$/, '$2'));
  for (const family of families) problems.push({ level: 'error', kind: 'font', family });

  // Every file the page asked this server for (its stylesheets' fonts and images, its fetches too):
  // which ones aren't there is asked once all the designs are checked
  for (const entry of win.performance.getEntriesByType('resource')) {
    const { path } = where(entry.name);
    if (path && !path.startsWith('/__explorer/') && !path.startsWith('/api/')) resources.set(path, entry.responseStatus || 0);
  }

  // Icons drawn from a sprite: the names a sprite file doesn't have are asked once all the designs are
  // checked (each sprite read once); one in the page itself, now
  for (const use of doc.querySelectorAll('use')) {
    const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
    const hash = href.indexOf('#');
    let id = href.slice(hash + 1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // as it is
    }
    if (hash < 0 || !id) continue;
    if (hash === 0) {
      if (!doc.getElementById(id)) addCounted(problems, { level: 'error', kind: 'icon', id });
      continue;
    }
    const { path } = where(new URL(href.slice(0, hash), doc.baseURI).href);
    if (!path) continue; // another site's
    if (!icons.has(path)) icons.set(path, new Map());
    icons.get(path).set(id, (icons.get(path).get(id) || 0) + 1);
  }

  if (!body.innerText.trim() && ![...body.querySelectorAll('*')].some((el) => !hidden(el) && rect(el).width > 0 && rect(el).height > 0)) {
    problems.push({ level: 'error', kind: 'blank' });
    return;
  }

  const { beyond, cut, spilled, bottom } = layoutProblems(win, doc, measures);
  if (beyond.length) {
    const elements = beyond.slice(0, MOST).map(({ el, right }) => ({ selector: el === body ? 'body' : describe(el), right }));
    problems.push({ level: 'layout', kind: 'beyond', frame: win.innerWidth, elements, ...(beyond.length > MOST ? { more: beyond.length - MOST } : {}) });
  }
  for (const [map, kind] of [[cut, 'cut'], [spilled, 'spill']]) {
    for (const [box, { count, ...detail }] of [...map].slice(0, MOST)) {
      problems.push({ level: 'layout', kind, selector: describe(box), ...detail, ...(count > 1 ? { count } : {}) });
    }
    if (map.size > MOST) problems.push({ level: 'layout', kind, more: map.size - MOST });
  }

  // Text too close in colour to what's behind it, a note for each pair of colours, the worst first;
  // and a note for the text over an image or a gradient, which can't be measured
  const { low, unmeasured } = lowContrast(win, doc, measures);
  const pairs = new Map();
  for (const { el, text, ratio, needs: needed, color, background } of low) {
    const key = `${color} ${background} ${needed}`;
    if (pairs.has(key)) pairs.get(key).count++;
    else pairs.set(key, { ratio: shownRatio(ratio), needs: needed, color, background, selector: describe(el), text, count: 1 });
  }
  const worst = [...pairs.values()].sort((a, b) => a.ratio - b.ratio);
  for (const { count, ...pair } of worst.slice(0, MOST)) problems.push({ level: 'note', kind: 'contrast', ...pair, ...(count > 1 ? { count } : {}) });
  if (worst.length > MOST) problems.push({ level: 'note', kind: 'contrast', more: worst.length - MOST });
  if (unmeasured.length) {
    const [{ el, text }] = unmeasured;
    problems.push({ level: 'note', kind: 'contrast', unmeasured: true, selector: describe(el), text, ...(unmeasured.length > 1 ? { count: unmeasured.length } : {}) });
  }

  // A frame of fixed height cuts what goes past it (fine for a screen that scrolls, not for a flyer)
  if (design.height && bottom > win.innerHeight + 1) {
    problems.push({ level: 'note', kind: 'below', bottom: Math.round(bottom), frame: win.innerHeight });
  }
}

/**
 * Where a page's layout goes wrong, by element: the outermost boxes that cross the frame's right edge
 * (or, in the page's flow, start past it) with something to see in them (`beyond`: { el, right }); the
 * boxes that cut text off (`cut`: box → { overflow, text, count }) and the ones text spills out of
 * (`spilled`: box → { text, count }); and where the content that no box keeps inside ends (`bottom`).
 */
export function layoutProblems(win, doc, measures = measurer(win, doc)) {
  const { style, rect, hidden, keeps } = measures;
  const body = doc.body;

  // Content cut at the right edge: a box that hides or scrolls its overflow keeps it inside
  const width = win.innerWidth;
  const beyond = [];
  const hasContent = (el) => el.matches(MEDIA) || Boolean(el.querySelector(MEDIA)) || Boolean(el.innerText?.trim());
  const visit = (el) => {
    for (const child of el.children) {
      const s = style(child);
      if (NOT_TEXT.has(child.localName) || s.display === 'none' || s.position === 'fixed') continue;
      const r = rect(child);
      const crosses = r.left < width - 1 && r.right > width + 1;
      const past = r.left >= width && s.position === 'static' && s.transform === 'none';
      if ((crosses || past) && r.width > 0 && r.height > 0 && !hidden(child) && hasContent(child)) {
        beyond.push({ el: child, right: Math.round(r.right) });
      } else if (s.overflowX === 'visible') {
        visit(child);
      }
    }
  };
  if (rect(body).right > width + 1 && hasContent(body)) beyond.push({ el: body, right: Math.round(rect(body).right) });
  else visit(body);

  // Text: cut off by a box that hides what overflows it, or spilling out of its box. Each text is
  // measured against the boxes around it, from the nearest, up to the first it doesn't fit in (or one
  // that keeps its overflow inside: past it, nothing can cut it).
  const cut = new Map(); // box → { overflow, text, count }
  const spilled = new Map();
  const note = (map, box, node, detail) => {
    if (map.has(box)) map.get(box).count++;
    else map.set(box, { ...detail, text: snippet(node.data), count: 1 });
  };
  let bottom = 0; // where the content that no box keeps inside ends
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.data.trim() || !parent || NOT_TEXT.has(parent.localName) || hidden(parent)) continue;
    range.selectNodeContents(node);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!lines.length) continue;
    const text = {
      left: Math.min(...lines.map((r) => r.left)),
      right: Math.max(...lines.map((r) => r.right)),
      top: Math.min(...lines.map((r) => r.top)),
      bottom: Math.max(...lines.map((r) => r.bottom)),
    };
    // A line's box is taller than its line when the line height is small: that much isn't overflow
    const slack = parseFloat(style(parent).fontSize) * 0.35 + 1 || 6;
    let kept = false;
    for (let el = parent; el && el !== body; el = el.parentElement) {
      const s = style(el);
      if (s.display === 'inline' || s.display === 'contents') continue;
      const r = rect(el);
      const overX = text.left < r.left - 1 || text.right > r.right + 1;
      const overY = text.top < r.top - slack || text.bottom > r.bottom + slack;
      if (!overX && !overY) {
        if (keeps(el)) {
          kept = true;
          break;
        }
        continue;
      }
      kept = true;
      const cuts = (overX && CLIPS.has(s.overflowX)) || (overY && CLIPS.has(s.overflowY));
      const scrolls = (overX && SCROLLS.has(s.overflowX)) || (overY && SCROLLS.has(s.overflowY));
      const meant = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none') || r.width <= 2 || r.height <= 2;
      if (meant) break;
      if (cuts) note(cut, el, node, { overflow: overX && CLIPS.has(s.overflowX) ? s.overflowX : s.overflowY });
      else if (!scrolls) note(spilled, el, node, {});
      break;
    }
    if (!kept) bottom = Math.max(bottom, text.bottom);
  }
  for (const media of body.querySelectorAll(MEDIA)) {
    const r = rect(media);
    if (r.width > 0 && r.height > 0 && !hidden(media) && ![...ancestors(media, body)].some(keeps)) bottom = Math.max(bottom, r.bottom);
  }
  return { beyond, cut, spilled, bottom };
}

// Icons the pages draw from sprites that don't have them. Each sprite is read once, however many
// designs use it; one that isn't there is a missing file.
async function findMissingIcons(results) {
  const sprites = new Map(); // path → the ids it has; null when it isn't there, undefined when it can't be told
  for (const { icons } of results) for (const file of icons.keys()) sprites.set(file, undefined);
  await Promise.all([...sprites.keys()].map(async (file) => {
    try {
      const res = await fetch(encodeURI(file), { cache: 'no-store' });
      if (res.status === 404) sprites.set(file, null);
      else if (res.ok) sprites.set(file, new Set([...(await res.text()).matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])));
    } catch {
      // Can't tell
    }
  }));
  for (const { icons, problems } of results) {
    for (const [file, ids] of icons) {
      const has = sprites.get(file);
      if (has === null) {
        if (!problems.some((problem) => problem.kind === 'missing' && problem.path === file)) problems.push({ level: 'error', kind: 'missing', path: file, tag: 'use' });
        continue;
      }
      if (!has) continue;
      for (const [id, count] of ids) if (!has.has(id)) problems.push({ level: 'error', kind: 'icon', path: file, id, ...(count > 1 ? { count } : {}) });
    }
  }
}

// Colours as the page computes them, in any syntax (rgb(), oklch(), color(display-p3 …)), in sRGB:
// [r, g, b, a], read from the syntax for rgb(), else painted on a 1 × 1 canvas and read back
const colours = new Map();
let swatch = null;
function rgba(colour) {
  if (colours.has(colour)) return colours.get(colour);
  let value;
  const rgb = colour.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    value = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  } else {
    swatch ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    swatch.clearRect(0, 0, 1, 1);
    swatch.fillStyle = '#000';
    swatch.fillStyle = colour;
    swatch.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
    value = [r, g, b, a / 255];
  }
  colours.set(colour, value);
  return value;
}

/**
 * The page's texts whose colour is too close to their background's for AA (`low`: { el, text, ratio,
 * needs, color, background }), and the ones over a picture, which can't be measured (`unmeasured`:
 * { el, text }): an image, or an image file as a background. What's behind a text is what the page
 * shows under the middle of its first line: the boxes there, blended down to the first opaque colour,
 * else to the page's own backdrop (the Canvas colour of its colour scheme). A gradient may put any of
 * its stops behind the text, and the worst counts; a texture (see imageOf) doesn't count; a box
 * between the text and its background that fades (opacity) fades the text. Left alone: text hidden, transparent, visually hidden (a box of 1 px that
 * hides its overflow), disabled or aria-hidden, covered by something that paints (a dialog's backdrop),
 * or outside the frame.
 */
export function lowContrast(win, doc, measures = measurer(win, doc)) {
  const { style, rect, hidden, keeps } = measures;
  const low = [];
  const unmeasured = [];
  const probe = doc.createElement('span');
  probe.style.cssText = 'display: none; color: Canvas;';
  doc.documentElement.append(probe);
  const backdrop = rgba(style(probe).color);
  probe.remove();
  const paints = (box) => PICTURES.has(box.localName) || style(box).backgroundImage !== 'none' || rgba(style(box).backgroundColor)[3] > 0;
  const tucked = (el) => {
    for (let box = el; box && box !== doc.body; box = box.parentElement) {
      const r = rect(box);
      if ((r.width <= 2 || r.height <= 2) && keeps(box)) return true;
    }
    return false;
  };
  const seen = new Set();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!node.data.trim() || !el || seen.has(el) || NOT_TEXT.has(el.localName) || hidden(el)) continue;
    seen.add(el);
    if (el.closest('svg, [aria-hidden="true"], :disabled, [aria-disabled="true"], [inert]')) continue;
    const ink = rgba(style(el).webkitTextFillColor || style(el).color);
    if (!ink[3]) continue; // transparent on purpose (a button that covers a dialog's backdrop)
    range.selectNodeContents(node);
    const line = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0);
    if (!line) continue;
    const x = line.left + line.width / 2;
    const y = line.top + line.height / 2;
    if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight || tucked(el)) continue;
    const text = snippet(node.data);
    // What the page shows there, the box on top first: what's over the text, then it and what's under it
    const stack = doc.elementsFromPoint(x, y);
    const at = stack.indexOf(el);
    if (at > 0 && stack.slice(0, at).some((box) => !el.contains(box) && paints(box))) continue;
    const under = at >= 0 ? stack.slice(at) : [el, ...ancestors(el)]; // one that takes no pointer: what's around it
    // The boxes behind it, down to the first with a solid colour of its own: a picture among them, and
    // it can't be measured
    const boxes = [];
    let picture = false;
    for (const box of under) {
      const own = style(box);
      if ((PICTURES.has(box.localName) && box !== el) || imageOf(own, rect(box)).picture) {
        picture = true;
        break;
      }
      boxes.push(box);
      if (rgba(own.backgroundColor)[3] >= 1) break;
    }
    if (picture) {
      unmeasured.push({ el, text });
      continue;
    }
    // What can be behind it, from the bottom up: each box's colour over what's under it, and each stop
    // of a gradient over that (any of them may be behind the text: the worst counts)
    let behind = [backdrop];
    for (const box of boxes.reverse()) {
      const own = style(box);
      const colour = rgba(own.backgroundColor);
      if (colour[3] > 0) behind = behind.map((under) => over(colour, under));
      const { stops } = imageOf(own, rect(box));
      if (stops.length) behind = [...new Map(stops.flatMap((stop) => behind.map((under) => over(stop, under))).map((c) => [hex(c), c])).values()].slice(0, 16);
    }
    // The boxes from the text up to the first with a background of its own fade it with their opacity
    let fade = 1;
    for (let box = el; box && box !== doc.documentElement; box = box.parentElement) {
      if (paints(box)) break;
      fade *= parseFloat(style(box).opacity);
    }
    let ratio = Infinity;
    let color;
    let background;
    for (const under of behind) {
      const shown = over([ink[0], ink[1], ink[2], ink[3] * fade], under);
      const each = contrastRatio(shown, under);
      if (each < ratio) [ratio, color, background] = [each, hex(shown), hex(under)];
    }
    const needed = needs(style(el).fontSize, style(el).fontWeight);
    if (ratio < needed) low.push({ el, text, ratio, needs: needed, color, background });
  }
  return { low, unmeasured };
}

/** A computed list (background-image, -size, -repeat) split at its top-level commas */
function layersOf(list) {
  const layers = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= list.length; i++) {
    const char = list[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if ((char === ',' && !depth) || i === list.length) {
      layers.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  return layers;
}

/**
 * What a box's background images put behind its text: whether one is a picture (an image file), and
 * the colours of its gradients' stops. Only a layer that covers the box counts, repeating or as big
 * as it: a small one is a decoration beside the text (a select's arrow, an icon, an underline). A
 * pattern drawn in a data: URL (a button's noise) is taken as a texture that leaves the colour under
 * it as it is.
 */
function imageOf(own, box) {
  const found = { picture: false, stops: [] };
  if (!own.backgroundImage || own.backgroundImage === 'none') return found;
  const sizes = layersOf(own.backgroundSize || 'auto');
  const repeats = layersOf(own.backgroundRepeat || 'repeat');
  const covers = (size, full) => !/^[\d.]+(px|%)$/.test(size) || (size.endsWith('%') ? parseFloat(size) >= 100 : parseFloat(size) >= full - 1);
  layersOf(own.backgroundImage).forEach((layer, i) => {
    if (layer === 'none' || /^url\(\s*["']?data:/i.test(layer)) return;
    const [width, height = width] = sizes[i % sizes.length].split(/\s+/);
    const repeat = repeats[i % repeats.length].split(/\s+/);
    const [across, down] = repeat.length === 2
      ? repeat.map((each) => each !== 'no-repeat')
      : [!['no-repeat', 'repeat-y'].includes(repeat[0]), !['no-repeat', 'repeat-x'].includes(repeat[0])];
    if (!(across || covers(width, box.width)) || !(down || covers(height, box.height))) return;
    if (/^url\(/i.test(layer)) found.picture = true;
    else found.stops.push(...(layer.match(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi) || []).map(rgba));
  });
  return found;
}

function snippet(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 40 ? `${flat.slice(0, 39)}…` : flat;
}

function* ancestors(el, until) {
  for (let node = el.parentElement; node && node !== until; node = node.parentElement) yield node;
}

/**
 * How to find an element: its tag (but div and span) with its id or first classes, after the
 * element around it that has one when it has neither; and, inside a component, the component first.
 */
function describe(el) {
  const own = (node) => {
    if (node.localName.includes('-')) return `<${node.localName}>`;
    const tag = node.localName === 'div' || node.localName === 'span' ? '' : node.localName;
    if (node.id) return `${tag}#${node.id}`;
    const classes = [...node.classList].slice(0, 2);
    return classes.length ? `${tag}.${classes.join('.')}` : node.localName;
  };
  let text = own(el);
  if (!el.id && !el.classList.length && !el.localName.includes('-')) {
    const named = el.parentElement?.closest('[id], [class]');
    if (named && named !== el.ownerDocument.body) text = `${own(named)} ${text}`;
  }
  const component = [...ancestors(el)].find((node) => node.localName.includes('-'));
  if (component && !text.startsWith('<')) text = `<${component.localName}> ${text}`;
  return text;
}

// Same-origin files the pages asked for that the server doesn't have, components' files among them.
// Each file is asked about once, however many designs use it.
async function findMissing(results) {
  const status = new Map(); // path → HTTP status (0: not known yet)
  for (const { resources, problems } of results) {
    for (const [file, code] of resources) if (code || !status.has(file)) status.set(file, code);
    for (const problem of problems) if (problem.path && !status.has(problem.path)) status.set(problem.path, 0);
  }
  await Promise.all([...status].filter(([, code]) => !code).map(async ([file]) => {
    try {
      status.set(file, (await fetch(encodeURI(file), { method: 'HEAD', cache: 'no-store' })).status);
    } catch {
      // Can't tell
    }
  }));
  const missing = (file) => status.get(file) === 404;
  for (const { resources, problems } of results) {
    const named = new Set();
    for (const problem of problems) {
      if (!problem.path) continue;
      named.add(problem.path);
      if (problem.kind === 'component') problem.found = !missing(problem.path);
      else if (problem.kind === 'load' && missing(problem.path)) problem.kind = 'missing';
    }
    for (const [file] of resources) {
      if (missing(file) && !named.has(file)) problems.push({ level: 'error', kind: 'missing', path: file });
    }
  }
}
