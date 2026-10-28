import fs from 'node:fs';
import path from 'node:path';

// Which designs a folder holds, and how the canvas shows them.
//
// Every HTML file is a design; its folder is its section (named after the folder, without its
// number prefix), and number prefixes on files and folders set the order (01-…, 02-…). A file
// describes itself in its <head>:
//
//   <title>Agenda</title>                                    the design's name
//   <meta name="description" content="…">                    its description
//   <meta name="htmlboard" content="width=390, height=844, category=mobile">   ("skip" leaves it out)
//   <meta name="htmlboard:label" content="claro">            added to the name of the file's own frame
//   <meta name="htmlboard:variant" content="?tema=escuro · escuro">   one more frame of the same file
//
// A designs.json beside them is optional and only curates: sections with their titles, the order,
// overrides for a design's values. Designs it doesn't list come after the ones it does (unless it
// says "unlisted": "hide").

/** Folders discovery leaves alone (hidden ones too) */
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build']);

/** Default frame size for each device category; anything else is 1200 wide and grows with its page */
const CATEGORY_SIZES = {
  mobile: [390, 844],
  tablet: [768, 1024],
  components: [720, 600],
  desktop: [1280, 800]
};
const DEFAULT_WIDTH = 1200;

/**
 * Guess what a design is for: words in its path first, then its size when it is a screen's (a
 * phone's width, a tablet's portrait 3:4, a desktop's landscape). Boards, flyers and other formats
 * get none (null). Without a height (a page that grows) only the width counts.
 */
export function inferCategory(file, width, height) {
  const lower = file.toLowerCase();
  if (/mobile|phone|iphone/.test(lower)) return 'mobile';
  if (/tablet|ipad/.test(lower)) return 'tablet';
  if (/component|\bui\b|atomic/.test(lower)) return 'components';
  if (/desktop|laptop/.test(lower)) return 'desktop';
  if (!width) return null;
  if (width <= 480) return 'mobile';
  if (!height) return width >= 1024 ? 'desktop' : width >= 600 ? 'tablet' : null;
  const ratio = height / width;
  if (width >= 600 && width <= 1100 && ratio >= 1.3 && ratio <= 1.45) return 'tablet';
  if (width >= 1024 && ratio <= 0.8) return 'desktop';
  return null;
}

/** "01-home" → "home": a number prefix (up to three digits) only orders */
export function stripPrefix(name) {
  return name.replace(/^\d{1,3}[-_. ]+(?=\S)/, '');
}

function slugify(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A file or folder name as a title: prefix and extension off, - and _ as spaces */
function humanize(name) {
  return stripPrefix(name.replace(/\.html?$/i, '')).replace(/[-_]+/g, ' ').trim() || name;
}

function folderTitle(folder) {
  return folder.split('/').map(humanize).join(' / ');
}

/** A design's id: its path without prefixes and extension (and with its query), as a slug */
function designId(file) {
  const [filePath, query = ''] = file.split(/\?(.*)/s);
  const bare = filePath.replace(/\.html?$/i, '').split('/').map(stripPrefix).join('/');
  return slugify(query ? `${bare}-${query}` : bare);
}

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// ---------------------------------------------------------------- what a file says

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function attributes(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([^\s"'<>/=]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** <meta name="htmlboard" content="width=390, height=844, category=mobile"> (or "skip") */
function parseSettings(content) {
  const settings = {};
  for (const part of content.split(/[,;]/)) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (key === 'skip' && (!value || /^(true|yes)$/i.test(value))) settings.skip = true;
    else if ((key === 'width' || key === 'height') && /^\d+$/.test(value) && Number(value) > 0) settings[key] = Number(value);
    else if (key === 'category' && value) settings.category = value.toLowerCase();
  }
  return settings;
}

/** <meta name="htmlboard:variant" content="?tema=escuro · escuro">: the query, then a label */
function parseVariant(content) {
  const [, first, rest] = content.match(/^(\S+)\s*(.*)$/s);
  const query = first.startsWith('?') ? first : `?${first}`;
  if (query === '?') return null;
  return { query, label: rest.replace(/^[·|:,\-–—]+\s*/, '').trim() };
}

/** What an HTML file says about itself, from its <head> (see the top of this file) */
export function parseDesignMeta(html) {
  const end = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = end >= 0 ? html.slice(0, end) : html.slice(0, 65536);
  const meta = { variants: [] };
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const text = decode(title[1]).replace(/\s+/g, ' ').trim();
    if (text) meta.title = text;
  }
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    const name = (attrs.name || '').toLowerCase();
    const content = (attrs.content || '').trim();
    if (!content) continue;
    if (name === 'description') meta.description = content;
    else if (name === 'htmlboard') Object.assign(meta, parseSettings(content));
    else if (name === 'htmlboard:label') meta.label = content;
    else if (name === 'htmlboard:variant') {
      const variant = parseVariant(content);
      if (variant) meta.variants.push(variant);
    }
  }
  return meta;
}

const metaCache = new Map(); // full path → { mtimeMs, size, meta }

/** parseDesignMeta for a file, read again only when it changed */
export function readDesignMeta(fullPath) {
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return null;
  }
  const cached = metaCache.get(fullPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.meta;
  let meta;
  try {
    meta = parseDesignMeta(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    meta = { variants: [] };
  }
  metaCache.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
  return meta;
}

// ---------------------------------------------------------------- the designs in a folder

function fileDesign(file, folder, meta) {
  const title = meta.title || humanize(path.posix.basename(file));
  const device = CATEGORY_SIZES[meta.category || inferCategory(file)];
  const width = meta.width || device?.[0] || DEFAULT_WIDTH;
  const height = meta.height ?? (meta.width ? undefined : device?.[1]);
  return compact({
    key: file,
    file,
    folder,
    title: meta.label ? `${title} · ${meta.label}` : title,
    baseTitle: title,
    description: meta.description,
    width,
    height,
    category: meta.category
  });
}

function variantDesign(base, { query, label }) {
  return compact({
    ...base,
    key: base.file + query,
    file: base.file + query,
    title: `${base.baseTitle} · ${label || query.slice(1)}`,
    variantOf: base.file
  });
}

/**
 * Every design in the folder, in order: the files of a folder by name (number prefixes order
 * them), each followed by its variants, then its subfolders by name.
 */
export function scanDesigns(baseDir) {
  const designs = [];
  const walk = (dir, folder) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries = entries.filter((e) => !e.name.startsWith('.') && !IGNORED_DIRS.has(e.name)).sort((a, b) => byName(a.name, b.name));
    for (const entry of entries) {
      if (!entry.isFile() || !/\.html?$/i.test(entry.name)) continue;
      const file = folder ? `${folder}/${entry.name}` : entry.name;
      const meta = readDesignMeta(path.join(dir, entry.name));
      if (!meta || meta.skip) continue;
      const base = fileDesign(file, folder, meta);
      designs.push(base);
      for (const variant of meta.variants) designs.push(variantDesign(base, variant));
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), folder ? `${folder}/${entry.name}` : entry.name);
    }
  };
  walk(baseDir, '');
  return designs;
}

/** Designs grouped into one section per folder, in order (`rootName` for the files at the top) */
function groupByFolder(designs, rootName = '') {
  const groups = new Map();
  for (const design of designs) {
    if (!groups.has(design.folder ?? '')) {
      const folder = design.folder ?? '';
      groups.set(folder, { name: folder ? folderTitle(folder) : rootName, folder, artboards: [] });
    }
    groups.get(design.folder ?? '').artboards.push(design);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------- designs.json

const OVERRIDES = ['title', 'description', 'width', 'height', 'category', 'tags', 'id'];

function toEntry(entry) {
  if (typeof entry === 'string') return entry ? { file: entry } : null;
  return entry && entry.file ? { ...entry, file: String(entry.file) } : null;
}

const normFolder = (folder) => String(folder).replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');

/** A designs.json entry: the file's own design (or a variant of it) with the entry's values on top */
function resolveEntry(entry, byKey) {
  const file = entry.file;
  let design = byKey.get(file);
  if (!design && file.includes('?')) {
    const base = byKey.get(file.split('?')[0]);
    if (base) design = variantDesign(base, { query: file.slice(file.indexOf('?')), label: '' });
  }
  if (!design) {
    const filePath = file.split('?')[0];
    const folder = path.posix.dirname(filePath);
    design = { key: file, file, folder: folder === '.' ? '' : folder, title: humanize(path.posix.basename(filePath)) };
  }
  design = { ...design };
  for (const key of OVERRIDES) if (entry[key] !== undefined) design[key] = entry[key];
  return design;
}

/** designs.json's sections filled from the files, then the designs it doesn't list */
function curate(config, found) {
  const byKey = new Map(found.map((d) => [d.key, d]));
  const sources = (Array.isArray(config.sections) ? config.sections : []).map((section) => ({
    section,
    entries: (section.designs ?? section.artboards ?? []).map(toEntry).filter(Boolean)
  }));
  const listed = new Set(sources.flatMap(({ entries }) => entries.map((e) => e.file)));
  const used = new Set();
  const free = (d) => !used.has(d.key) && !listed.has(d.key);

  const sections = sources.map(({ section, entries }) => {
    const artboards = [];
    const add = (design) => {
      used.add(design.key);
      artboards.push(design);
    };
    for (const entry of entries) {
      add(resolveEntry(entry, byKey));
      // A file's variants follow it, unless designs.json places them itself
      if (!entry.file.includes('?')) for (const d of found) if (d.variantOf === entry.file && free(d)) add(d);
    }
    // { "folder": "…" } brings the folder's designs it doesn't list
    if (section.folder) for (const d of found) if (d.folder === normFolder(section.folder) && free(d)) add(d);
    const { designs, artboards: _artboards, title, ...rest } = section;
    return { ...rest, name: section.name ?? title ?? '', artboards };
  });

  // A section owns a folder it names, or the one folder (not the top) all its designs come from;
  // the folder's new designs join it.
  const owners = new Map();
  sources.forEach(({ section }, i) => {
    const folders = section.folder
      ? [normFolder(section.folder)]
      : [...new Set(sections[i].artboards.map((d) => d.folder ?? ''))];
    if (folders.length !== 1 || (!section.folder && !folders[0])) return;
    owners.set(folders[0], owners.has(folders[0]) && owners.get(folders[0]) !== i ? -1 : i);
  });

  const unlisted = found.filter((d) => !used.has(d.key));
  const rest = [];
  for (const design of unlisted) {
    const owner = owners.get(design.folder ?? '');
    if (owner !== undefined && owner >= 0) sections[owner].artboards.push(design);
    else rest.push(design);
  }
  if (config.unlisted !== 'hide') sections.push(...groupByFolder(rest, 'Unlisted'));

  const { sections: _sections, ...top } = config;
  return { ...top, sections };
}

/** Ids, paths from the served root, categories; and nothing the explorer doesn't need */
function finalize(manifest, prefix = '') {
  const usedIds = new Set();
  const uniqueId = (wanted) => {
    let id = wanted || 'design';
    for (let n = 2; usedIds.has(id); n++) id = `${wanted}-${n}`;
    usedIds.add(id);
    return id;
  };
  const sections = manifest.sections.map((section, i) => {
    const { folder, artboards, ...rest } = section;
    const name = section.name ?? '';
    return {
      ...rest,
      id: section.id ?? (slugify(name) || (folder ? slugify(folder.split('/').map(stripPrefix).join('-')) : `section-${i + 1}`)),
      name,
      artboards: artboards.map((design) => {
        const { key, folder: _folder, baseTitle, variantOf, ...board } = design;
        const category = board.category ?? inferCategory(design.file.split('?')[0], board.width, board.height);
        return compact({
          ...board,
          id: uniqueId(board.id ?? designId(design.file)),
          file: prefix ? path.posix.join(prefix, design.file) : design.file,
          category
        });
      })
    };
  });
  return { ...manifest, sections };
}

/** The designs of a folder without a designs.json: one section per folder */
export function discoverDesigns(baseDir) {
  return finalize({
    title: path.basename(path.resolve(baseDir)) || 'Designs',
    autoDiscovered: true,
    sections: groupByFolder(scanDesigns(baseDir))
  });
}

/**
 * A manifest's sections with ids and categories filled in, without looking at any file (the short
 * form works: sections[].title and designs[] of file names or { file, title, width, height }).
 */
export function normalizeManifest(manifest, prefix = '') {
  const { unlisted, ...result } = finalize(curate({ ...manifest, unlisted: 'hide' }, []), prefix);
  return manifest.unlisted === undefined ? result : { ...result, unlisted: manifest.unlisted };
}

/**
 * What the explorer shows for a designs folder: its files, curated by its designs.json when it has
 * one. With `rootDir` (a folder containing baseDir), file paths are given relative to it.
 */
export function loadDesignsManifest(baseDir, rootDir = baseDir) {
  const prefix = path.relative(rootDir, baseDir).split(path.sep).join('/');
  const found = scanDesigns(baseDir);
  const configPath = path.join(baseDir, 'designs.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...finalize(curate(config, found), prefix), autoDiscovered: false };
    } catch (err) {
      console.warn(`[htmlboard] Failed parsing designs.json: ${err.message}. Showing the files without it.`);
    }
  }
  return {
    ...finalize({ title: path.basename(path.resolve(baseDir)) || 'Designs', sections: groupByFolder(found) }, prefix),
    autoDiscovered: true
  };
}
