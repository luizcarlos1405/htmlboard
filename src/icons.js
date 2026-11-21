import fs from 'node:fs';
import path from 'node:path';

// `htmlboard icons add`: icons by name, from a set (Lucide), kept in one sprite at the top of the
// designs folder (icons.svg), so designs draw them as <svg class="icon"><use href="icons.svg#users"/></svg>
// instead of drawing their own. Each icon is fetched once, from the set's package on a CDN, and kept
// as a <symbol> with the set's own viewBox, stroke and fill; the sprite notes the set, its version
// and its license. Only adding needs the network: the designs then work offline.

/** The sprite `icons add` writes, at the top of the designs folder */
export const SPRITE = 'icons.svg';

/**
 * The sets icons come from, by the name --set takes: the npm package that has their SVGs, where an
 * icon is in it, the file of its tags (for names that aren't there) and of its license.
 */
export const SETS = {
  lucide: {
    name: 'Lucide',
    package: 'lucide-static',
    icon: (name) => `icons/${name}.svg`,
    tags: 'tags.json',
    license: 'LICENSE',
    site: 'https://lucide.dev/icons',
  },
};

const CDN = 'https://cdn.jsdelivr.net/npm';
const REGISTRY = 'https://registry.npmjs.org';
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// What a symbol keeps of its icon's <svg>: what draws it, not its size or its class
const KEEP = new Set(['viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule']);

/** Icons couldn't be added (an unknown set, no network): exit code 2 */
export class IconsError extends Error {}

/** The ids of the symbols in a sprite's markup */
export function symbolsOf(svg) {
  return [...svg.matchAll(/<symbol\b[^>]*?\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}

/** An icon's SVG as a <symbol id=name>: its viewBox, stroke and fill kept, its drawing as it is */
export function symbolOf(name, svg) {
  const open = svg.match(/<svg\b([^>]*)>/i);
  const end = svg.lastIndexOf('</svg>');
  if (!open || end < open.index) throw new IconsError(`${name} isn't an SVG`);
  const kept = [...open[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)]
    .filter(([, key]) => KEEP.has(key.toLowerCase()))
    .map(([, key, value]) => ` ${key}="${value}"`)
    .join('');
  const drawing = svg.slice(open.index + open[0].length, end)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `    ${line}`)
    .join('\n');
  return `  <symbol id="${name}"${kept}>\n${drawing}\n  </symbol>`;
}

/** A comment can't hold "--": a run of dashes gets spaces between them */
const commented = (text) => text.replace(/-{2,}/g, (dashes) => dashes.split('').join(' ')).trim();

/** The note at the top of a sprite for a set: its name, version and license */
function noteFor(set, version, license) {
  const source = `${set.name} icons (${set.package} ${version}), from ${set.site}. Add more with: npx htmlboard icons add <names>`;
  return `  <!-- ${commented(source)}\n\n${commented(license).split('\n').map((line) => `  ${line}`.trimEnd()).join('\n')}\n  -->`;
}

/** Names close to one that isn't in the set: the same but for a letter or two, else sharing its words or tags */
function suggestionsFor(name, tags) {
  const words = name.split('-').map((word) => word.replace(/s$/, ''));
  const scored = [];
  for (const [icon, keywords] of Object.entries(tags)) {
    const distance = editDistance(name, icon);
    const terms = new Set([...icon.split('-'), ...keywords.flatMap((keyword) => String(keyword).toLowerCase().split(/[\s-]+/))]
      .map((term) => term.replace(/s$/, '')));
    const shared = words.filter((word) => terms.has(word)).length;
    const score = distance <= 2 ? 10 - distance : shared + (icon.startsWith(words[0]) ? 0.5 : 0);
    if (score >= 1) scored.push({ icon, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.icon.length - b.icon.length).slice(0, 3).map(({ icon }) => icon);
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/**
 * Add icons, by name, to the designs folder's sprite (made if missing): the ones it has already are
 * kept as they are.
 *
 * @param {string[]} names Icon names in the set (Lucide's: users, search, chevrons-up-down)
 * @param {object} [options]
 * @param {string} [options.dir=process.cwd()] The designs folder
 * @param {string} [options.set='lucide'] The set (see SETS)
 * @param {typeof fetch} [options.fetch] How to fetch (Node's own by default)
 * @returns {Promise<{path: string, added: string[], had: string[], unknown: {name: string, suggestions: string[]}[],
 *   set: string, version: ?string}>} The sprite, the icons added, the ones it already had, and the
 *   names that aren't in the set, with names close to them
 */
export async function addIcons(names, { dir = process.cwd(), set = 'lucide', fetch = globalThis.fetch } = {}) {
  const source = SETS[set];
  if (!source) throw new IconsError(`There is no icon set "${set}": use ${Object.keys(SETS).join(', ')}`);
  const bad = names.filter((name) => !NAME.test(name));
  if (bad.length) throw new IconsError(`${bad.join(', ')} ${bad.length === 1 ? "isn't an icon name" : "aren't icon names"} (${source.name}'s are like chevrons-up-down)`);
  const designsDir = path.resolve(dir);
  if (!fs.statSync(designsDir, { throwIfNoEntry: false })?.isDirectory()) throw new IconsError(`There is no folder ${dir}`);
  const file = path.join(designsDir, SPRITE);
  const sprite = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const have = new Set(sprite ? symbolsOf(sprite) : []);
  const wanted = [...new Set(names)];
  const had = wanted.filter((name) => have.has(name));
  const missing = wanted.filter((name) => !have.has(name));
  const result = { path: file, added: [], had, unknown: [], set, version: null };
  if (!missing.length) return result;

  const get = async (url, what) => {
    try {
      return await fetch(url);
    } catch (error) {
      throw new IconsError(`Couldn't reach ${new URL(url).host} for ${what} (${error.cause?.message || error.message}). Adding icons needs the network; the designs then work offline.`);
    }
  };
  const latest = await get(`${REGISTRY}/${source.package}/latest`, `${source.name}'s version`);
  if (!latest.ok) throw new IconsError(`Couldn't find ${source.name}'s version (${source.package}: HTTP ${latest.status})`);
  const { version } = await latest.json();
  result.version = version;
  const base = `${CDN}/${source.package}@${version}`;

  const found = [];
  for (const name of missing) {
    const res = await get(`${base}/${source.icon(name)}`, name);
    if (res.status === 404) result.unknown.push({ name, suggestions: [] });
    else if (!res.ok) throw new IconsError(`Couldn't fetch ${name} from ${source.name} (HTTP ${res.status})`);
    else found.push({ name, symbol: symbolOf(name, await res.text()) });
  }
  if (result.unknown.length && source.tags) {
    const res = await get(`${base}/${source.tags}`, `${source.name}'s names`).catch(() => null);
    const tags = res?.ok ? await res.json().catch(() => null) : null;
    if (tags) for (const unknown of result.unknown) unknown.suggestions = suggestionsFor(unknown.name, tags);
  }
  if (!found.length) return result;

  const licenseRes = await get(`${base}/${source.license}`, `${source.name}'s license`).catch(() => null);
  const license = licenseRes?.ok ? await licenseRes.text() : `See ${source.site} for its license.`;
  const note = noteFor(source, version, license);
  const symbols = found.map(({ symbol }) => symbol).join('\n');
  let svg;
  if (!sprite) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg">\n${note}\n${symbols}\n</svg>\n`;
  } else {
    // The set's note says the version the newest icons are from; one made by hand gets one
    const old = new RegExp(`  <!-- ${source.name} icons \\(${source.package} [^)]*\\)[\\s\\S]*?-->`);
    svg = old.test(sprite) ? sprite.replace(old, note) : sprite.replace(/<svg\b[^>]*>/i, (open) => `${open}\n${note}`);
    const end = svg.lastIndexOf('</svg>');
    svg = `${svg.slice(0, end).trimEnd()}\n${symbols}\n${svg.slice(end)}`;
  }
  fs.writeFileSync(file, svg);
  result.added = found.map(({ name }) => name);
  return result;
}

/**
 * What adding did, in a few lines: the icons added and where, the ones the sprite had, the names
 * that aren't in the set with names close to them, and how a design draws one.
 *
 * @param {Awaited<ReturnType<typeof addIcons>>} result
 * @param {object} [options]
 * @param {string} [options.name] How to call the sprite (default: its full path)
 */
export function formatIcons({ path: file, added, had, unknown, set, version }, { name = file } = {}) {
  const source = SETS[set];
  const lines = [];
  if (added.length) lines.push(`  ✓ added ${added.join(', ')} to ${name} (${source.name} ${version})`);
  if (had.length) lines.push(`  = already in it: ${had.join(', ')}`);
  for (const { name: missing, suggestions } of unknown) {
    lines.push(`  ! there is no ${missing} in ${source.name}${suggestions.length ? `: ${suggestions.join(', ')}?` : ''} (${source.site})`);
  }
  const first = added[0] || had[0];
  if (first) lines.push('', `  Draw one as <svg class="icon"><use href="${SPRITE}#${first}"/></svg> (../${SPRITE} from a folder in it), sized in CSS.`);
  return `${lines.join('\n')}\n`;
}
