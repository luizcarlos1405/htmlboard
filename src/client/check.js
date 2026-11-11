// Checking the designs (`htmlboard check`). Each design loads afresh, out of sight, in a frame of its
// size, so the check sees the files as they are now, whatever the canvas shows (a filter, a reload
// on its way). Once its page settles, the check reads what went wrong:
//
//   - what the probe noted while the page built (probe.js, which the server puts in framed pages):
//     script errors, console.error, files that didn't load;
//   - files the page asked for that aren't there (a stylesheet's fonts and images too);
//   - components that weren't built, fonts that didn't load, a page that shows nothing;
//   - layout: content cut at the frame's right edge, or below a frame of fixed height; text cut off
//     by a box that hides what overflows it; text spilling out of its box.
//
// What a design means to do is left alone: text that ends in an ellipsis or is clamped, boxes that
// scroll, content hidden or moved off the page on purpose.

import { themeFor, showTheme, setTheme, themesOf, inOrder } from './theme.js';

const AT_ONCE = 4; // designs loading at the same time
const LOAD_MS = 10000; // a page that hasn't loaded by then is checked as it is, and said so
const QUIET_MS = 300; // a page whose content hasn't changed for this long has settled…
const SETTLE_MS = 3000; // …or this long after it loaded, if it keeps changing
const MOST = 5; // boxes listed for a layout problem; the rest are counted

const MEDIA = 'img, svg, video, canvas, picture, iframe, embed, object, input, select, textarea, button';
const NOT_TEXT = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'option', 'title']);
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
  return results.map(({ resources, found, ...result }) => result);
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
  const result = { ...runs[0][1], problems: [], resources: new Map(), themes: runs.map(([label]) => label) };
  delete result.found;
  const seen = new Map(); // problem as JSON → { problem, labels }
  for (const [label, run] of runs) {
    for (const [file, code] of run.resources) if (code || !result.resources.has(file)) result.resources.set(file, code);
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
    problems: [], resources: new Map(),
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
    inspect(page.win, page.doc, design, result);
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

function inspect(win, doc, design, { problems, resources }) {
  const body = doc.body;
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

  if (!body.innerText.trim() && ![...body.querySelectorAll('*')].some((el) => !hidden(el) && rect(el).width > 0 && rect(el).height > 0)) {
    problems.push({ level: 'error', kind: 'blank' });
    return;
  }

  // Content cut at the right edge: the outermost boxes that cross it (or, in the page's flow, start
  // past it) with something to see in them. A box that hides or scrolls its overflow keeps it inside.
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
        beyond.push({ selector: describe(child), right: Math.round(r.right) });
      } else if (s.overflowX === 'visible') {
        visit(child);
      }
    }
  };
  if (rect(body).right > width + 1 && hasContent(body)) beyond.push({ selector: 'body', right: Math.round(rect(body).right) });
  else visit(body);
  if (beyond.length) {
    problems.push({ level: 'layout', kind: 'beyond', frame: width, elements: beyond.slice(0, MOST), ...(beyond.length > MOST ? { more: beyond.length - MOST } : {}) });
  }

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
  for (const [map, kind] of [[cut, 'cut'], [spilled, 'spill']]) {
    for (const [box, { count, ...detail }] of [...map].slice(0, MOST)) {
      problems.push({ level: 'layout', kind, selector: describe(box), ...detail, ...(count > 1 ? { count } : {}) });
    }
    if (map.size > MOST) problems.push({ level: 'layout', kind, more: map.size - MOST });
  }

  // A frame of fixed height cuts what goes past it (fine for a screen that scrolls, not for a flyer)
  if (design.height && bottom > win.innerHeight + 1) {
    problems.push({ level: 'note', kind: 'below', bottom: Math.round(bottom), frame: win.innerHeight });
  }
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
