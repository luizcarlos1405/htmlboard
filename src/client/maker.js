// Pictures made out of sight. The browser the server opens (see server.js) runs this page at
// /?worker&maker=<n>&engine=<chromium|firefox>, which asks the server for a design to picture, then the
// next, for as long as it runs. Each design loads afresh in a frame of its size, as check and shot load
// it, in the theme and system mode the canvas shows; once it has settled, Chromium's tab is shot by the
// server (the frame is at its top left, the only thing in it), and Firefox draws it as the canvas would
// (picture.js) and sends it.

import { hiddenBox, openDesign } from './check.js';
import { drawDesign } from './picture.js';
import { themeFor, themesOf } from './theme.js';

const DEFAULT_SIZE = [1200, 800]; // as the canvas: a design whose entry gives no size
const FIT_HEIGHT = 100; // a frame that fits its page however short (a component's) starts this tall
const AT_ONCE = 3; // Firefox: pictures drawn at once in its one page
const RETRY_MS = 2000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Makes pictures for as long as the page runs: `maker`, which one it is; `engine`, its browser's */
export function makePictures({ maker, engine }) {
  const loops = engine === 'firefox' ? AT_ONCE : 1; // a Chromium tab is shot whole: one design at a time
  for (let i = 0; i < loops; i++) makeNext(maker, engine);
}

async function makeNext(maker, engine) {
  for (;;) {
    let job = null;
    try {
      const res = await fetch(`/api/pictures/next?maker=${maker}`, { method: 'POST' });
      if (res.status === 200) job = await res.json();
      else if (res.status !== 204) await wait(RETRY_MS);
    } catch {
      await wait(RETRY_MS); // the server is gone, or busy
    }
    if (job) await make(job, maker, engine);
  }
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
}

async function make(job, maker, engine) {
  const { design } = job;
  const width = Number(design.width) || DEFAULT_SIZE[0];
  const height = Number(design.height) || 0;
  const box = engine === 'firefox' ? hiddenBox() : shownBox();
  try {
    const page = await openDesign(
      { file: design.file, width, height, frameHeight: height || (design.fit ? FIT_HEIGHT : DEFAULT_SIZE[1]) },
      box,
      { grow: true, theme: themeFor(design.themes, job.theme), own: job.scheme },
    );
    if (!page.doc) throw new Error('the page shows nothing');
    const report = {
      job: job.id,
      width,
      height: parseFloat(page.frame.style.height),
      files: filesOf(page),
      // The themes its stylesheets have, for the canvas's theme switch, when the design doesn't say them
      themes: design.themes?.values?.length ? [] : themesOf(page.doc, design.themes?.attribute),
    };
    if (engine === 'firefox') {
      const canvas = await drawDesign(page.frame, { width, height: report.height, scale: job.scale });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
      canvas.width = 0; // its pixels can go
      if (!blob) throw new Error('no picture');
      await post('/api/pictures', { ...report, type: blob.type, image: await base64(blob) });
    } else {
      await post(`/api/pictures?shoot&maker=${maker}`, report); // answered once the server has shot it
    }
  } catch (error) {
    await post('/api/pictures', { job: job.id, failed: String(error?.message || error) }).catch(() => {});
  } finally {
    box.remove();
  }
}

// Where a Chromium tab has its design: at the top left, over everything, on the white a frame of the
// canvas has behind its page. The server sizes the tab to the frame before it shoots.
function shownBox() {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; background: #FFFFFF; overflow: hidden; pointer-events: none;';
  document.body.append(box);
  return box;
}

// The files the page used, as it loaded them (this server's): it's made again when one changes
function filesOf(page) {
  const urls = new Set([page.doc.URL]);
  try {
    for (const entry of page.win.performance.getEntriesByType('resource')) {
      const url = new URL(entry.name);
      if (url.origin === location.origin) urls.add(url.href);
    }
  } catch {
    // Can't tell: its own file only
  }
  return [...urls];
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
