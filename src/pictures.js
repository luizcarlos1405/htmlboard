import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Pictures of the designs, which the canvas shows zoomed out. They're kept between visits in the
// designs folder's .htmlboard/, which git ignores by itself (its own .gitignore says *): one per
// design, theme, system mode (light or dark) and scale, with the files its page used. A picture whose
// files haven't changed since shows at once; a save makes again only the pictures of the designs that
// used the file. The browser the server opens out of sight makes them (see server.js), a few at once.

export const CACHE_FOLDER = '.htmlboard';
const PICTURES_FOLDER = 'pictures';
const INDEX_FILE = 'pictures.json';
/** Pictures kept by an htmlboard that made them another way are made again */
const FORMAT = 1;
const GITIGNORE = '# htmlboard keeps pictures of the designs here, to show them at once. Nothing in it is to be committed.\n*\n';
export const IMAGE_TYPES = { 'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg' };
const IMAGE_NAME = /^[0-9a-f]{16}-[0-9a-z]+\.(webp|png|jpg)$/;
/** A picture that couldn't be made this many times waits for its files to change */
const TRIES = 2;
/** A picture made while one of its files changed is made again, at most this many times in a row */
const AGAIN = 3;
/** A picture being made this long is given up on (its maker is gone), and tried again */
const WORK_MS = 60000;
/** The pictures of a design no longer on the canvas are kept this long (a branch checked out and back) */
const GONE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A design's name for its pictures, as /api/designs gives it: its file (a variant's with its query),
 * width and height (empty when the design doesn't say, and grows with its page). The canvas has the
 * same (explorer.js).
 */
export const designKey = ({ file, width, height }) => `${file}|${Number(width) || ''}|${Number(height) || ''}`;

/** One picture of a design: in a theme ('' for the page's own), a system mode ('light' or 'dark'), at a scale */
export const pictureKey = (design, { theme = '', scheme = 'light', scale = 0.25 }) => `${designKey(design)}|${theme}|${scheme}|${scale}`;

/** What a request says about the pictures it wants: theme, system mode and scale, checked */
export function pictureParams({ theme, scheme, scale } = {}) {
  const value = Number(scale);
  return {
    theme: typeof theme === 'string' ? theme.trim() : '',
    scheme: scheme === 'dark' ? 'dark' : 'light',
    scale: Number.isFinite(value) && value > 0 && value <= 2 ? Math.round(value * 1000) / 1000 : 0.25,
  };
}

/**
 * The pictures kept for a designs folder (`designsDir`), whose pages' files are under `rootDir`. Nothing
 * is written until a picture is: a server for one command leaves no .htmlboard/ behind.
 */
export function openPictures(designsDir, rootDir) {
  const folder = path.join(designsDir, CACHE_FOLDER);
  const imagesDir = path.join(folder, PICTURES_FOLDER);
  const indexFile = path.join(folder, INDEX_FILE);
  const entries = new Map(); // picture key → { image, height, themes, deps: { file: [mtimeMs, size] | null }, at }
  let loaded = false;
  let saveTimer = null;
  let made = 0;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const saved = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      if (saved?.format === FORMAT && saved.pictures && typeof saved.pictures === 'object') {
        for (const [key, entry] of Object.entries(saved.pictures)) {
          if (entry && IMAGE_NAME.test(entry.image)) entries.set(key, entry);
        }
      }
    } catch {
      // None yet, or unreadable: they're made again
    }
    // Images no picture has any more (a crash between writing one and the list)
    let names = [];
    try {
      names = fs.readdirSync(imagesDir);
    } catch {
      return;
    }
    const kept = new Set([...entries.values()].map((entry) => entry.image));
    for (const name of names) if (!kept.has(name)) fs.rmSync(path.join(imagesDir, name), { force: true });
  }

  // The folder, ignored by git wherever the repository's root is
  function prepare() {
    fs.mkdirSync(imagesDir, { recursive: true });
    const ignore = path.join(folder, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, GITIGNORE);
  }

  function write() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      prepare();
      const temporary = `${indexFile}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ format: FORMAT, pictures: Object.fromEntries(entries) }));
      fs.renameSync(temporary, indexFile);
    } catch {
      // A folder that can't be written: the pictures last as long as the server
    }
  }

  const save = () => {
    saveTimer ||= setTimeout(write, 250);
  };

  // A file's [mtimeMs, size], or null when there's none: asked once per memo
  const statOf = (file, memo) => {
    if (memo.has(file)) return memo.get(file);
    let value = null;
    try {
      const stat = fs.statSync(path.join(rootDir, file));
      if (stat.isFile()) value = [stat.mtimeMs, stat.size];
    } catch {
      // Not there
    }
    memo.set(file, value);
    return value;
  };

  function isFresh(entry, memo) {
    for (const [file, saved] of Object.entries(entry.deps || {})) {
      const now = statOf(file, memo);
      if (saved === null ? now !== null : !now || now[0] !== saved[0] || now[1] !== saved[1]) return false;
    }
    return true;
  }

  return {
    folder,

    /** The pictures kept for these keys: key → { image, height, themes, fresh } (fresh: its files haven't changed) */
    find(keys) {
      load();
      const memo = new Map();
      const found = new Map();
      for (const key of keys) {
        const entry = entries.get(key);
        if (!entry || !fs.existsSync(path.join(imagesDir, entry.image))) continue;
        found.set(key, { image: entry.image, height: entry.height, themes: entry.themes || [], fresh: isFresh(entry, memo) });
      }
      return found;
    },

    /**
     * Keeps a picture: `image` (its bytes, of `type`), the height its page had (`height`), the themes its
     * stylesheets have (`themes`), the files its page used (`files`, from the root) and when its page
     * started loading (`since`, ms since the epoch): a file changed after that makes it out of date at
     * once. Returns what find() would.
     */
    put(key, { height, themes = [], files = [], since = 0 }, image, type = 'image/webp') {
      load();
      prepare();
      // A name of its own each time: the canvas keeps an image by its URL for good
      const name = `${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}-${Date.now().toString(36)}${(++made).toString(36)}${IMAGE_TYPES[type] || '.webp'}`;
      fs.writeFileSync(path.join(imagesDir, name), image);
      const before = entries.get(key);
      if (before && before.image !== name) fs.rmSync(path.join(imagesDir, before.image), { force: true });
      const memo = new Map();
      const deps = {};
      for (const file of files) {
        const now = statOf(file, memo);
        deps[file] = now && since && now[0] > since ? [-1, -1] : now;
      }
      const entry = { image: name, height: Math.round(Number(height)) || 0, themes: [...new Set(themes.map(String))], deps, at: Date.now() };
      entries.set(key, entry);
      save();
      return { image: name, height: entry.height, themes: entry.themes, fresh: isFresh(entry, memo) };
    },

    /**
     * Forgets the pictures of the designs that are gone (`keep(designKey)` says which stay), once
     * they're a week old: a design back by then (another branch checked out, then this one) has them
     */
    prune(keep, now = Date.now()) {
      load();
      let removed = false;
      const old = now - GONE_MS;
      for (const [key, entry] of entries) {
        if (keep(key.split('|').slice(0, 3).join('|')) || !(entry.at < old)) continue;
        entries.delete(key);
        fs.rmSync(path.join(imagesDir, entry.image), { force: true });
        removed = true;
      }
      if (removed) save();
    },

    /** The file of a kept image, by its name (null for any other name) */
    imageFile(name) {
      return IMAGE_NAME.test(name) ? path.join(imagesDir, name) : null;
    },

    /** Writes the list now (the server stops) */
    flush() {
      if (saveTimer) write();
    },
  };
}

/**
 * The pictures to make, in order, and the ones being made. Makers (pages of the browser out of sight)
 * ask for the next one (next), then say it's done or couldn't be made (done). onChange(progress) hears
 * every change: `{ done, total }` of the pictures asked for since it was last idle.
 */
export function pictureQueue({ onChange = () => {} } = {}) {
  const pending = []; // jobs, the first one next
  const working = new Map(); // job id → job
  const tries = new Map(); // picture key → pictures that couldn't be made
  const again = new Map(); // picture key → made again in a row, its files changing meanwhile
  const waiting = new Set(); // makers waiting for a job
  let count = 0;
  let done = 0;
  let total = 0;

  const changed = () => {
    if (!pending.length && !working.size) {
      onChange({ done: total, total });
      done = 0;
      total = 0;
    } else {
      onChange({ done, total });
    }
  };

  function take() {
    // A maker gone with its job: the job is tried again
    const now = Date.now();
    for (const job of working.values()) if (now - job.startedAt > WORK_MS) finish(job.id, false, { quiet: true });
    const job = pending.shift();
    if (!job) return null;
    job.startedAt = Date.now();
    working.set(job.id, job);
    return job;
  }

  function redo(job) {
    const times = (again.get(job.key) || 0) + 1;
    again.set(job.key, times);
    if (times > AGAIN) return;
    pending.push({ ...job, id: `${++count}` });
    total++;
  }

  function serve() {
    for (const maker of [...waiting]) {
      if (!pending.length) break;
      waiting.delete(maker);
      maker(take());
    }
  }

  function finish(id, ok, { quiet = false, fresh = true } = {}) {
    const job = working.get(id);
    if (!job) return null;
    working.delete(id);
    if (ok) {
      done++;
      tries.delete(job.key);
      if (fresh) again.delete(job.key);
      else redo(job);
    } else {
      const failed = (tries.get(job.key) || 0) + 1;
      tries.set(job.key, failed);
      if (failed < TRIES) pending.push(job);
      else {
        done++; // given up on until its files change
        job.gaveUp = true;
      }
    }
    serve();
    if (!quiet) changed();
    return job;
  }

  return {
    /**
     * Pictures to make, first first (`jobs`: `{ key, design, theme, scheme, scale }`): put before the
     * ones already waiting. A picture being made, or given up on, isn't asked again. Returns how many
     * are new.
     */
    want(jobs) {
      const first = [];
      let added = 0;
      for (const job of jobs) {
        if ((tries.get(job.key) || 0) >= TRIES || [...working.values()].some((w) => w.key === job.key)) continue;
        const at = pending.findIndex((p) => p.key === job.key);
        if (at >= 0) first.push(...pending.splice(at, 1));
        else {
          first.push({ ...job, id: `${++count}` });
          added++;
        }
      }
      if (!first.length) return 0;
      pending.unshift(...first);
      total += added;
      serve();
      changed();
      return added;
    },

    /** The next picture to make, waiting `ms` for one (null when none came); `signal` stops the wait */
    next(ms, signal) {
      const job = take();
      if (job) {
        changed();
        return Promise.resolve(job);
      }
      return new Promise((resolve) => {
        const maker = (found) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', stop);
          changed();
          resolve(found);
        };
        const stop = () => {
          clearTimeout(timer);
          waiting.delete(maker);
          resolve(null);
        };
        const timer = setTimeout(stop, ms);
        signal?.addEventListener('abort', stop, { once: true });
        waiting.add(maker);
      });
    },

    /** A job being made (null when it isn't) */
    job(id) {
      return working.get(String(id)) || null;
    },

    /**
     * A job made (ok) or that couldn't be made: returns it, or null when it wasn't being made. A picture
     * made while one of its files changed (`fresh`: false) is made again, unless that keeps happening.
     */
    done(id, ok, { fresh = true } = {}) {
      return finish(String(id), ok, { fresh });
    },

    /** A job handed out that its maker couldn't take: waiting again, first */
    giveBack(job) {
      if (!working.delete(job.id)) return;
      pending.unshift(job);
      serve();
    },

    /**
     * The makers are gone (their browser quit): what they were making waits again, as a try that
     * failed (a page that makes the browser crash is given up on)
     */
    stopAll() {
      for (const id of [...working.keys()]) finish(id, false, { quiet: true });
    },

    /** Drops what's waiting (no browser can make it) */
    clear() {
      pending.length = 0;
      working.clear();
      changed();
    },

    /** Files changed: pictures given up on are tried again */
    forgetFailures() {
      tries.clear();
      again.clear();
    },

    idle() {
      return !pending.length && !working.size;
    },

    progress() {
      return { done, total };
    },
  };
}
