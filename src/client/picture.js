// A design as an image, to copy or save it. The browser draws it from the page as its frame has it:
// the page's HTML and CSS go into an SVG <foreignObject>, with the files they use (stylesheets, fonts,
// images) inlined, since an image can't load anything. Scripts don't run in an image, so it shows the
// page as built when it was taken.
//
// What it can't show: images from another site that doesn't allow reading them (CORS), pages inside
// the page (iframes), shadow DOM. A video shows the frame it is at, or its poster.

const MAX_SIDE = 16384; // px: the longest side browsers draw a canvas at
const MAX_AREA = 64e6; // px: about 256 MB of pixels
const FULL_AREA = 16e6; // px: the most a page is drawn at its size before it's shrunk (see drawDesign)
const LOAD_MS = 10000;
const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const IMPORT_RULE = 3;
const MEDIA_RULE = 4;
const FONT_FACE_RULE = 5;
const PREFERS_SCHEME = /prefers-color-scheme/i;
const LEFT_OUT = new Set(['script', 'noscript', 'style', 'link', 'source', 'track']);

// What pictures of several designs share, read once for all of them: the files (fonts, images) as
// data: URLs, and each linked stylesheet's CSS, for each set of its fonts the designs use. Kept until
// forgetFiles(): after a file changes, or once every picture is made.
const newCache = () => ({ files: new Map(), sheets: new Map(), svgs: new Map() });
const shared = newCache();

export function forgetFiles() {
  shared.files.clear();
  shared.sheets.clear();
  shared.svgs.clear();
}

/**
 * The page in `iframe` drawn on a canvas, `width` × `height` CSS px at `scale` device px per CSS px
 * (less when that would make a canvas too big to draw). `crop`: only that box of the page (CSS px,
 * `{ x, y, width, height }`). `fresh`: its files read again, not shared with other pictures (a shot
 * right after a save, before the canvas has heard of it).
 */
export async function drawDesign(iframe, { width, height, scale = 1, crop = null, fresh = false }) {
  const canvas = await drawPage(iframe, { width, height, scale, cache: fresh ? newCache() : shared });
  if (!crop) return canvas;
  const factor = canvas.width / width; // the scale it was drawn at
  const part = sized(crop.width * factor, crop.height * factor);
  part.getContext('2d').drawImage(canvas, crop.x * factor, crop.y * factor, crop.width * factor, crop.height * factor, 0, 0, part.width, part.height);
  canvas.width = 0; // its pixels can go
  return part;
}

async function drawPage(iframe, { width, height, scale, cache }) {
  const doc = await loaded(iframe);
  const win = iframe.contentWindow;
  await doc.fonts?.ready;
  const files = reader(win, cache);
  // A frame shown in light or dark (its color-scheme set: a theme) prefers that mode, where the image
  // drawn from it would prefer the system's: the page's rules for prefers-color-scheme are decided by
  // the frame, and its <html> keeps the mode it has there (light-dark(), the browser's own colours).
  if (iframe.style.colorScheme) files.frame = win;
  const [css, root] = await Promise.all([styles(doc, files), copyPage(doc, files)]);
  if (files.frame) root.style.colorScheme = usedScheme(doc, win);
  const style = doc.createElement('style');
  style.textContent = css;
  (root.querySelector('head') || root).append(style);
  const markup = new XMLSerializer().serializeToString(root);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`;
  const image = new Image();
  // A data: URL, not a blob: one, which would keep the canvas from being read (Chromium)
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await image.decode();
  } catch {
    throw new Error('the browser couldn’t draw this page');
  }
  const most = Math.min(MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)));
  scale = Math.min(scale, most);
  const canvas = sized(width * scale, height * scale);
  const context = canvas.getContext('2d');
  // The page's background fills the frame in a browser; in an image it would cover only its box.
  context.fillStyle = backdrop(doc, win);
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Drawn smaller than its size, Firefox lays the page out in a window that small, so its media
  // queries and vw/vh units would make another page (a desktop design in its phone layout): there
  // it's drawn at its size first, then shrunk.
  const full = Math.min(1, most, Math.sqrt(FULL_AREA / (width * height)));
  if (scale < full && await shrinksImages()) {
    let page = sized(width * full, height * full);
    page.getContext('2d').drawImage(image, 0, 0, page.width, page.height);
    // Halved until it's at most twice the size: shrunk at once, most of its pixels would be skipped
    while (page.width > canvas.width * 2 || page.height > canvas.height * 2) {
      const half = sized(page.width / 2, page.height / 2);
      half.getContext('2d').drawImage(page, 0, 0, half.width, half.height);
      page.width = 0; // its pixels can go
      page = half;
    }
    context.drawImage(page, 0, 0, canvas.width, canvas.height);
    page.width = 0;
  } else {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  image.src = ''; // the copy of the page it holds can go now, not when memory runs short
  return canvas;
}

function sized(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

// Whether the browser lays out an image drawn smaller than its size in a window of the smaller size
// (Firefox), told once: a box 100vw × 100vh fills an image 40 px wide, drawn at 10.
let shrinking = null;
function shrinksImages() {
  shrinking ||= (async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><foreignObject width="40" height="40">'
      + '<div xmlns="http://www.w3.org/1999/xhtml" style="width: 100vw; height: 100vh; background: #000"></div>'
      + '</foreignObject></svg>';
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const canvas = sized(10, 10);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 10, 10);
    return context.getImageData(9, 9, 1, 1).data[3] < 128; // laid out 10 px wide, the box is 2.5 px
  })().catch(() => false);
  return shrinking;
}

/** The frame's page once it has loaded (a frame reloading after a save is waited for) */
function loaded(iframe) {
  const ready = () => {
    const doc = iframe.contentDocument;
    return doc && doc.readyState === 'complete' && doc.URL !== 'about:blank' ? doc : null;
  };
  if (ready()) return Promise.resolve(ready());
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      iframe.removeEventListener('load', done);
      if (ready()) resolve(ready());
      else reject(new Error('the page didn’t load'));
    };
    const timer = setTimeout(done, LOAD_MS);
    iframe.addEventListener('load', done);
  });
}

// ---------------------------------------------------------------- the files the page uses

// Reads the files the page uses as data: URLs, each once (once for all the pictures sharing `cache`).
// `used` holds the files the page loaded, to leave out the fonts it never needed (another alphabet's
// part of a font); null when it can't tell.
function reader(win, cache) {
  let used = null;
  try {
    const entries = win.performance.getEntriesByType('resource');
    if (entries.length < 250) used = new Set(entries.map((entry) => entry.name)); // browsers stop listing at 250
  } catch {
    // Can't tell
  }
  const read = cache.files;
  return {
    used,
    sheets: cache.sheets,
    // '' when it can't be read: missing, or another site's that doesn't allow it
    dataUrl(url) {
      if (!read.has(url)) {
        read.set(url, fetch(url)
          .then((res) => (res.ok ? res.blob() : null))
          .then((blob) => (blob ? asDataUrl(blob) : ''))
          .catch(() => ''));
      }
      return read.get(url);
    },
    // An SVG file, parsed (a sprite of icons that <use> draws from); null when it can't be read
    svg(url) {
      if (!cache.svgs.has(url)) {
        cache.svgs.set(url, fetch(url)
          .then((res) => (res.ok ? res.text() : ''))
          .then((text) => {
            const parsed = text && new DOMParser().parseFromString(text, 'image/svg+xml');
            return parsed && !parsed.querySelector('parsererror') ? parsed : null;
          })
          .catch(() => null));
      }
      return cache.svgs.get(url);
    },
  };
}

function asDataUrl(blob) {
  return new Promise((resolve) => {
    const fileReader = new FileReader();
    fileReader.onload = () => resolve(String(fileReader.result));
    fileReader.onerror = () => resolve('');
    fileReader.readAsDataURL(blob);
  });
}

function absolute(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

/** CSS with every url(…) in it as a data: URL (an empty one for a file it can't read) */
async function inlineUrls(css, base, files) {
  const urls = new Map();
  for (const [, , raw] of css.matchAll(URL_RE)) {
    const url = raw.trim();
    if (!url || urls.has(url) || /^(data:|#|about:)/i.test(url)) continue;
    const full = absolute(url, base);
    if (full) urls.set(url, files.dataUrl(full));
  }
  if (!urls.size) return css;
  const data = new Map();
  for (const [url, reading] of urls) data.set(url, await reading);
  return css.replace(URL_RE, (whole, quote, raw) => {
    const value = data.get(raw.trim());
    return value === undefined ? whole : `url("${value || 'data:,'}")`;
  });
}

// ---------------------------------------------------------------- the page's CSS

/** All the CSS the page has, in its order, with the files it uses inlined */
async function styles(doc, files) {
  const parts = [];
  for (const sheet of doc.styleSheets) if (!sheet.disabled) parts.push(await sheetCss(sheet, doc.baseURI, files, []));
  for (const sheet of doc.adoptedStyleSheets || []) parts.push(await rulesCss(sheet.cssRules, doc.baseURI, files, []));
  return parts.join('\n');
}

/** The mode a page is in: light or dark, from its color-scheme and the one its frame prefers */
function usedScheme(doc, win) {
  const own = (win.getComputedStyle(doc.documentElement).colorScheme || 'normal').split(/\s+/);
  if (own.includes('light') && own.includes('dark')) return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return own.includes('dark') ? 'dark' : 'light';
}

/** Whether rules for `media` apply, when the frame decides (prefers-color-scheme, see drawPage); else null */
function decided(media, files) {
  return files.frame && PREFERS_SCHEME.test(media) ? files.frame.matchMedia(media).matches : null;
}

// `fonts` collects the files of the font faces read, to tell which of them a page used.
async function sheetCss(sheet, base, files, fonts, media = sheet.media?.mediaText) {
  if (media && decided(media, files) === false) return '';
  let css;
  if (sheet.href) {
    // A linked stylesheet, often the same in every design: read once for each set of its fonts used
    // (and in each mode, when the frame decides the rules for it)
    const saved = files.sheets.get(sheet.href);
    const key = saved && sheetKey(saved.fonts, files);
    if (saved?.css.has(key)) {
      css = saved.css.get(key);
      fonts.push(...saved.fonts);
    } else {
      const own = [];
      css = await readSheet(sheet, sheet.href, files, own);
      fonts.push(...own);
      const entry = saved || { fonts: own, css: new Map() };
      entry.css.set(sheetKey(entry.fonts, files), css);
      files.sheets.set(sheet.href, entry);
    }
  } else {
    css = await readSheet(sheet, base, files, fonts);
  }
  return media && media !== 'all' && decided(media, files) === null ? `@media ${media} {\n${css}\n}` : css;
}

async function readSheet(sheet, base, files, fonts) {
  try {
    return await rulesCss(sheet.cssRules, base, files, fonts);
  } catch {
    // Another site's stylesheet, which the page can use but not read: fetched again, as most allow
    // (font services and CDNs do).
    const css = sheet.href ? await fetch(sheet.href).then((res) => (res.ok ? res.text() : '')).catch(() => '') : '';
    return inlineUrls(css, base, files);
  }
}

async function rulesCss(rules, base, files, fonts) {
  const parts = [];
  for (const rule of rules) {
    if (rule.type === IMPORT_RULE) {
      let css = rule.styleSheet ? await sheetCss(rule.styleSheet, base, files, fonts, rule.media?.mediaText) : '';
      if (rule.supportsText) css = `@supports ${rule.supportsText} {\n${css}\n}`;
      if (rule.layerName != null) css = `@layer${rule.layerName ? ` ${rule.layerName}` : ''} {\n${css}\n}`;
      parts.push(css);
    } else if (rule.type === FONT_FACE_RULE) {
      const urls = fontFiles(rule, base);
      fonts.push(...urls);
      if (!unusedFont(urls, files.used)) parts.push(rule.cssText);
    } else if (rule.type === MEDIA_RULE && decided(rule.media.mediaText, files) !== null) {
      if (decided(rule.media.mediaText, files)) parts.push(await rulesCss(rule.cssRules, base, files, fonts));
    } else {
      parts.push(rule.cssText);
    }
  }
  return inlineUrls(parts.join('\n'), base, files);
}

// The files a font face loads from (not the ones inside it, as data: URLs)
function fontFiles(rule, base) {
  return [...rule.cssText.matchAll(URL_RE)].map((match) => match[2].trim())
    .filter((url) => !/^data:/i.test(url)).map((url) => absolute(url, base)).filter(Boolean);
}

// A font face whose files the page never loaded
function unusedFont(urls, used) {
  return Boolean(used) && urls.length > 0 && !urls.some((url) => used.has(url));
}

// Which of a stylesheet's fonts a page loaded: pages that loaded the same ones get the same CSS
function fontsKey(fonts, used) {
  return used ? fonts.filter((url) => used.has(url)).join(' ') : '*';
}

// The fonts it loaded, and the mode its frame decides the stylesheet's rules for, if it does
function sheetKey(fonts, files) {
  const mode = files.frame ? (files.frame.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : '';
  return `${mode}|${fontsKey(fonts, files.used)}`;
}

// ---------------------------------------------------------------- the page's HTML

/**
 * A copy of the page as it is now: without scripts and stylesheets (their CSS comes whole), with what
 * the page's elements hold but their markup doesn't say (the image each <img> chose, form values, a
 * canvas's drawing) and its files inlined.
 */
async function copyPage(doc, files) {
  const root = doc.documentElement;
  const copy = root.cloneNode(true);
  const live = [root, ...root.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')]; // the same elements, in the same order
  const waits = [];
  const vars = new Map(); // a file inline styles use → the custom property on the root that holds it
  const symbols = new Map(); // another file's symbol that <use> draws (`file#id`) → its id in the copy
  let sprite = null; // where the copy keeps them
  let count = 0;
  const symbolFrom = async (file, id) => {
    const key = `${file}#${id}`;
    if (!symbols.has(key)) {
      symbols.set(key, files.svg(file).then((svg) => {
        const symbol = svg?.getElementById(id);
        if (!symbol) return '';
        if (!sprite) {
          sprite = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
          sprite.setAttribute('aria-hidden', 'true');
          sprite.setAttribute('style', 'position: absolute; width: 0; height: 0; overflow: hidden');
          (copy.querySelector('body') || copy).append(sprite);
        }
        const inlined = doc.importNode(symbol, true);
        inlined.id = `htmlboard-symbol-${++count}`;
        sprite.append(inlined);
        return inlined.id;
      }));
    }
    return symbols.get(key);
  };
  live.forEach((el, i) => {
    const out = copies[i];
    const tag = el.localName;
    if (LEFT_OUT.has(tag)) {
      out.remove();
      return;
    }
    if (tag === 'img') {
      const src = el.currentSrc || el.src;
      for (const attribute of ['srcset', 'sizes', 'loading']) out.removeAttribute(attribute);
      if (src) waits.push(files.dataUrl(src).then((data) => out.setAttribute('src', data || TRANSPARENT)));
    } else if (tag === 'image' && (el.getAttribute('href') || el.getAttribute('xlink:href'))) {
      const full = absolute(el.getAttribute('href') || el.getAttribute('xlink:href'), doc.baseURI);
      if (full) {
        waits.push(files.dataUrl(full).then((data) => {
          out.removeAttribute('xlink:href');
          out.setAttribute('href', data || TRANSPARENT);
        }));
      }
    } else if (tag === 'use') {
      // A symbol from another file (a sprite of icons), which an image can't load: brought in
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      const hash = href.indexOf('#');
      const file = hash > 0 ? absolute(href.slice(0, hash), doc.baseURI) : null;
      if (file && hash < href.length - 1) {
        waits.push(symbolFrom(file, href.slice(hash + 1)).then((id) => {
          if (!id) return;
          out.removeAttribute('xlink:href');
          out.setAttribute('href', `#${id}`);
        }));
      }
    } else if (tag === 'canvas') {
      // Without scripts (as in an image), a canvas shows what it holds instead of its drawing
      asImage(el, out, canvasData(el));
    } else if (tag === 'video') {
      const frame = videoFrame(el);
      waits.push((frame || !el.poster ? Promise.resolve(frame) : files.dataUrl(el.poster)).then((data) => asImage(el, out, data, 'contain')));
    } else if (tag === 'iframe' || tag === 'frame' || tag === 'embed' || tag === 'object') {
      for (const attribute of ['src', 'srcdoc', 'data']) out.removeAttribute(attribute);
    } else if (tag === 'input') {
      if (el.type === 'checkbox' || el.type === 'radio') out.toggleAttribute('checked', el.checked);
      else if (el.type !== 'file') out.setAttribute('value', el.value);
    } else if (tag === 'textarea') {
      out.textContent = el.value;
    } else if (tag === 'option') {
      out.toggleAttribute('selected', el.selected);
    }
    const style = out.getAttribute('style');
    if (style && /url\(/i.test(style)) waits.push(styleUrls(style, doc.baseURI, files, vars).then((css) => out.setAttribute('style', css)));
  });
  await Promise.all(waits);
  if (vars.size) {
    const held = [...vars.values()].map(({ name, data }) => `${name}: url("${data || 'data:,'}")`);
    copy.setAttribute('style', [copy.getAttribute('style'), ...held].filter(Boolean).join('; '));
  }
  return copy;
}

/**
 * An inline style with each file it uses as var(--htmlboard-file-N), the custom property `vars` keeps
 * for that file (`vars`: absolute URL → `{ name, data, reading }`, shared by the elements of a copy,
 * whose root then holds each file once). Inlined in every element instead, an image a hundred elements
 * use would be in the picture a hundred times (90 MB for one page).
 */
export async function styleUrls(css, base, files, vars) {
  const urls = new Map();
  for (const [, , raw] of css.matchAll(URL_RE)) {
    const url = raw.trim();
    if (!url || urls.has(url) || /^(data:|#|about:)/i.test(url)) continue;
    const full = absolute(url, base);
    if (!full) continue;
    if (!vars.has(full)) {
      const entry = { name: `--htmlboard-file-${vars.size + 1}`, data: '' };
      entry.reading = files.dataUrl(full).then((data) => { entry.data = data; });
      vars.set(full, entry);
    }
    urls.set(url, vars.get(full));
  }
  for (const entry of urls.values()) await entry.reading;
  return css.replace(URL_RE, (whole, quote, raw) => {
    const entry = urls.get(raw.trim());
    return entry ? `var(${entry.name})` : whole;
  });
}

// An <img> of what a canvas or a video shows, in its place: its attributes (for the page's CSS) and
// the size the page gave it.
function asImage(el, out, data, fit = 'fill') {
  const img = el.ownerDocument.createElement('img');
  for (const { name, value } of out.attributes) {
    if (!['src', 'poster', 'autoplay', 'controls', 'width', 'height'].includes(name)) img.setAttribute(name, value);
  }
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  img.style.width = style.width;
  img.style.height = style.height;
  img.style.objectFit = fit;
  img.src = data || TRANSPARENT;
  out.replaceWith(img);
}

function canvasData(canvas) {
  try {
    return canvas.toDataURL();
  } catch {
    return 'data:,'; // drawn from another site: unreadable
  }
}

function videoFrame(video) {
  try {
    if (video.readyState < 2 || !video.videoWidth) return '';
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return '';
  }
}

/** The colour that fills the page behind its content: the root's background, or the body's, or white */
function backdrop(doc, win) {
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    const color = win.getComputedStyle(el).backgroundColor;
    if (color && !/^transparent$|,\s*0\)$|\/\s*0\)$/.test(color)) return color;
  }
  return '#FFFFFF';
}
