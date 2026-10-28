import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDesignsManifest, parseDesignMeta, stripPrefix } from './designs.js';

// `htmlboard migrate`: moves what a designs.json says about each design into the design's own file
// (its size, category, label, variants and description) and leaves designs.json with what only it
// can say: the sections, their titles and order, and values that differ from the files'.

const OWN_TAGS = /[ \t]*<meta\b[^>]*\bname\s*=\s*["']?htmlboard(?::label|:variant)?["'\s>][^>]*>[ \t]*(?:\r?\n)?/gi;
const SEP = ' · ';

const splitQuery = (file) => {
  const at = file.indexOf('?');
  return at < 0 ? [file, ''] : [file.slice(0, at), file.slice(at)];
};

const escapeAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function fallbackTitle(file) {
  return stripPrefix(path.posix.basename(file).replace(/\.html?$/i, '')).replace(/[-_]+/g, ' ').trim();
}

/** What follows "<title> · " in a title, or null when the title doesn't start with the file's */
function labelOf(title, fileTitle) {
  if (title === undefined) return '';
  if (title === fileTitle) return '';
  return title.startsWith(fileTitle + SEP) ? title.slice(fileTitle.length + SEP.length) : null;
}

/** The file's htmlboard tags, written after its <title> (replacing any it had) */
function rewriteHead(html, lines) {
  const cleaned = html.replace(OWN_TAGS, '');
  if (!lines.length) return cleaned;
  const title = cleaned.match(/^([ \t]*)<title[^>]*>[\s\S]*?<\/title>[^\n]*\n?/im);
  if (title) {
    const at = title.index + title[0].length;
    const eol = title[0].endsWith('\n') ? '' : '\n';
    return cleaned.slice(0, at) + eol + lines.map((line) => title[1] + line + '\n').join('') + cleaned.slice(at);
  }
  const head = cleaned.match(/<head[^>]*>[^\n]*\n?/i);
  const at = head ? head.index + head[0].length : 0;
  return cleaned.slice(0, at) + lines.map((line) => line + '\n').join('') + cleaned.slice(at);
}

/**
 * The migration of a designs folder: { files: [{ file, lines, html }], config, entries: [before,
 * after], unlisted: [files designs.json didn't list] }. Nothing is written.
 */
export function planMigration(designsDir) {
  const configPath = path.join(designsDir, 'designs.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sections = Array.isArray(config.sections) ? config.sections : [];

  // Every entry, by the file it shows
  const all = [];
  sections.forEach((section, s) => {
    (section.designs ?? section.artboards ?? []).forEach((raw, e) => {
      const entry = typeof raw === 'string' ? { file: raw } : raw && raw.file ? { ...raw, file: String(raw.file) } : null;
      if (!entry) return;
      const [base, query] = splitQuery(entry.file);
      all.push({ entry, base, query, s, e, keep: {} });
    });
  });
  const byBase = new Map();
  for (const item of all) {
    if (!byBase.has(item.base)) byBase.set(item.base, []);
    byBase.get(item.base).push(item);
  }

  const files = [];
  for (const [base, items] of byBase) {
    const full = path.join(designsDir, base);
    const main = items.find((item) => !item.query);
    const html = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    const meta = html === null ? null : parseDesignMeta(html);
    // Only files on disk, not skipped, whose own frame designs.json shows; anything else stays as it is
    if (!main || !meta || meta.skip) {
      for (const item of items) item.keep = { ...item.entry };
      continue;
    }
    const fileTitle = meta.title || fallbackTitle(base);
    const width = main.entry.width ?? meta.width;
    const height = main.entry.height ?? meta.height;
    const category = main.entry.category ?? meta.category;
    const settings = [width && `width=${width}`, height && `height=${height}`, category && `category=${category}`].filter(Boolean);
    const lines = [];
    if (settings.length) lines.push(`<meta name="htmlboard" content="${escapeAttr(settings.join(', '))}">`);

    const label = labelOf(main.entry.title, fileTitle);
    if (label === null) main.keep.title = main.entry.title;
    else if (label) lines.push(`<meta name="htmlboard:label" content="${escapeAttr(label)}">`);
    else if (meta.label && main.entry.title === undefined) lines.push(`<meta name="htmlboard:label" content="${escapeAttr(meta.label)}">`);
    if (main.entry.description !== undefined && !meta.description) {
      lines.push(`<meta name="description" content="${escapeAttr(main.entry.description)}">`);
    } else if (main.entry.description !== undefined && main.entry.description !== meta.description) {
      main.keep.description = main.entry.description;
    }
    for (const key of ['tags', 'id']) if (main.entry[key] !== undefined) main.keep[key] = main.entry[key];

    // The variants designs.json shows, in its order (then any the file declared that it didn't)
    const variants = items.filter((item) => item.query);
    const declared = meta.variants.filter((v) => !variants.some((item) => item.query === v.query));
    for (const item of variants) {
      const variantLabel = labelOf(item.entry.title, fileTitle);
      if (variantLabel === null) item.keep.title = item.entry.title;
      lines.push(`<meta name="htmlboard:variant" content="${escapeAttr(item.query + (variantLabel ? SEP + variantLabel : ''))}">`);
      for (const key of ['width', 'height', 'category']) {
        if (item.entry[key] !== undefined && item.entry[key] !== { width, height, category }[key]) item.keep[key] = item.entry[key];
      }
      for (const key of ['description', 'tags', 'id']) if (item.entry[key] !== undefined) item.keep[key] = item.entry[key];
    }
    for (const v of declared) lines.push(`<meta name="htmlboard:variant" content="${escapeAttr(v.query + (v.label ? SEP + v.label : ''))}">`);

    const next = rewriteHead(html, lines);
    if (next !== html) files.push({ file: base, lines, html: next });
  }

  // A variant that follows its file (or the file's other variants) in the same section, with
  // nothing left to say, comes from the file now
  const dropped = new Set();
  for (const item of all) {
    if (!item.query || Object.keys(item.keep).length || !byBase.get(item.base).some((i) => !i.query)) continue;
    const run = all.filter((i) => i.s === item.s && i.e < item.e).reverse();
    let follows = false;
    for (const before of run) {
      if (before.base !== item.base) break;
      if (!before.query) {
        follows = true;
        break;
      }
      if (!dropped.has(before)) break;
    }
    if (follows) dropped.add(item);
  }

  const next = { ...config };
  next.sections = sections.map((section, s) => {
    const { designs, artboards, ...rest } = section;
    const entries = all.filter((item) => item.s === s && !dropped.has(item)).map((item) => {
      const keep = Object.fromEntries(Object.entries(item.keep).filter(([key]) => key !== 'file'));
      return Object.keys(keep).length ? { file: item.entry.file, ...keep } : item.entry.file;
    });
    return { ...rest, designs: entries };
  });

  return { files, config: next, entries: [all.length, all.length - dropped.size] };
}

/** The canvas as a flat list, to compare two of them */
function canvasLines(manifest) {
  return manifest.sections.flatMap((section) => section.artboards.map((b) =>
    [section.name, b.title, b.file, b.width, b.height ?? 'grows', b.category ?? '-'].join(' | ')));
}

/**
 * The canvas the migration would leave, against today's: a list of differences (empty when
 * nothing changes), from a copy of the folder's HTML files with the plan applied.
 */
export function checkMigration(designsDir, plan) {
  const before = canvasLines(loadDesignsManifest(designsDir));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-migrate-'));
  try {
    const copy = (dir, rel) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const from = path.join(dir, entry.name);
        const to = path.join(temp, rel, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(to, { recursive: true });
          copy(from, path.join(rel, entry.name));
        } else if (/\.html?$/i.test(entry.name)) fs.copyFileSync(from, to);
      }
    };
    copy(designsDir, '');
    for (const { file, html } of plan.files) fs.writeFileSync(path.join(temp, file), html);
    fs.writeFileSync(path.join(temp, 'designs.json'), JSON.stringify(plan.config, null, 2) + '\n');
    const after = canvasLines(loadDesignsManifest(temp));
    const differences = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (before[i] !== after[i]) differences.push({ before: before[i], after: after[i] });
    }
    return differences;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/** Writes the plan: the files' tags and the shorter designs.json */
export function applyMigration(designsDir, plan) {
  for (const { file, html } of plan.files) fs.writeFileSync(path.join(designsDir, file), html);
  fs.writeFileSync(path.join(designsDir, 'designs.json'), JSON.stringify(plan.config, null, 2) + '\n');
}
