import fs from 'node:fs';
import path from 'node:path';
import { COMPONENTS_FOLDER, isPage, isTagName } from './components.js';
import { attributes, scanDesigns, normalizeThemes } from './designs.js';

// The catalog: what the designs in a folder share, read from the files every time, so it is never
// out of date. It describes whatever the project has and asks for none of it:
//
//   - the stylesheets the designs link, whatever their name or folder (and the ones at the top of
//     the folder, linked or not yet), with each local one's variables, classes, @keyframes and fonts;
//   - the scripts the designs load;
//   - the components in components/, with their attributes, slots, example and where they're used;
//   - the themes the designs have (as designs.json or the designs say, else as their stylesheets do).
//
// As text it takes a few lines (`htmlboard catalog`), so an agent learns what exists without
// reading every file.

const WIDTH = 100; // the text wraps here
const LONGEST_VALUE = 120; // a variable's value is cut after this many characters
const MOST_ITEMS = 200; // a stylesheet's classes or variables shown; the rest are counted
const MOST_NAMED = 3; // designs named; more are counted

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- CSS

/** Split `text` at `separator`, except inside strings, parentheses and brackets */
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote || char === '\n') quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if ((char === ')' || char === ']') && depth) depth--;
    else if (char === separator && !depth) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * A stylesheet as a tree of rules, enough to read what it defines: each rule's prelude (a selector
 * or an at-rule), the text of its own declarations, and the rules inside it. Comments are dropped.
 */
function parseCss(css) {
  const root = { prelude: '', text: '', rules: [] };
  const open = [root];
  let text = '';
  let quote = null;
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (quote) {
      text += char;
      if (char === '\\') text += css[++i] ?? '';
      else if (char === quote || char === '\n') quote = null;
    } else if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (char === '"' || char === "'") {
      quote = char;
      text += char;
    } else if (char === '{') {
      // The declarations before a nested rule end with ";", then comes its prelude
      const parts = splitTopLevel(text, ';');
      const rule = { prelude: parts.pop().trim(), text: '', rules: [] };
      open.at(-1).text += parts.map((part) => `${part};`).join('');
      open.at(-1).rules.push(rule);
      open.push(rule);
      text = '';
    } else if (char === '}') {
      open.at(-1).text += text;
      text = '';
      if (open.length > 1) open.pop();
    } else {
      text += char;
    }
  }
  open.at(-1).text += text;
  return root;
}

const IMPORT = /^@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')/i;

/** The URLs a stylesheet @imports */
function importsOf(tree) {
  return splitTopLevel(tree.text, ';')
    .map((statement) => statement.trim().match(IMPORT))
    .filter(Boolean)
    .map((match) => match.slice(1).find((value) => value !== undefined));
}

/** The class names in a selector, not counting its strings and attribute selectors */
function classesOf(selector) {
  const bare = selector.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '').replace(/\[[^\]]*\]/g, '');
  return [...bare.matchAll(/\.(-?(?:[_a-zA-Z\u0080-\uFFFF]|\\.)(?:[\w\u0080-\uFFFF-]|\\.)*)/g)].map((match) => match[1]);
}

/** A nested rule's selector, written out (`&` is the rule around it) */
function nest(outer, inner) {
  const scope = splitTopLevel(outer, ',').length > 1 ? `:is(${outer})` : outer;
  return splitTopLevel(inner, ',')
    .map((part) => part.trim())
    .map((part) => (part.includes('&') ? part.replaceAll('&', scope) : `${scope} ${part}`))
    .join(', ');
}

/** At-rules that hold rules for the page; the others (@keyframes, @font-face, @page…) don't */
const GROUPING_RULES = new Set(['media', 'supports', 'layer', 'container', 'scope', 'starting-style', 'document']);

const unquote = (text) => text.trim().replace(/^(["'])(.*)\1$/, '$2');

/**
 * What a stylesheet defines: its variables (with the selector that declares them), its classes,
 * @keyframes and font families, and what it @imports. And what its themes could be: the values its
 * selectors give attributes (`[data-theme="dark"]`), the classes they give <html>, and whether it
 * follows the system's light and dark modes (prefers-color-scheme, light-dark(), color-scheme).
 */
function readStylesheet(css) {
  const tree = parseCss(css);
  const variables = new Map(); // where → Map(name → value)
  const classes = new Set();
  const keyframes = new Set();
  const fonts = new Set();
  const valued = new Map(); // attribute → the values selectors give it
  const rootClasses = new Set();
  let scheme = false;
  const select = (selector) => {
    for (const [, name, ...values] of selector.matchAll(ATTRIBUTE_SELECTOR)) {
      const value = values.find((v) => v !== undefined);
      if (value === undefined) continue;
      if (!valued.has(name.toLowerCase())) valued.set(name.toLowerCase(), new Set());
      valued.get(name.toLowerCase()).add(value);
    }
    for (const [, names] of selector.matchAll(/(?:^|[\s,>+~(])(?:html|:root)((?:\.[\w-]+)+)/g)) {
      for (const name of names.split('.').filter(Boolean)) rootClasses.add(name);
    }
  };
  const declare = (where, text) => {
    if (/light-dark\(|color-scheme\s*:\s*(light\s+dark|dark\s+light)/i.test(text)) scheme = true;
    for (const declaration of splitTopLevel(text, ';')) {
      const match = declaration.match(/^\s*(--[^:\s]+)\s*:([\s\S]*)$/);
      if (!match) continue;
      if (!variables.has(where)) variables.set(where, new Map());
      variables.get(where).set(match[1], match[2].replace(/\s+/g, ' ').trim());
    }
  };
  const walk = (rules, at, selector) => {
    for (const { prelude, text, rules: inner } of rules) {
      if (prelude.startsWith('@')) {
        const name = prelude.match(/^@(?:-[a-z]+-)?([\w-]+)/i)?.[1].toLowerCase();
        if (name === 'keyframes') keyframes.add(unquote(prelude.replace(/^@[\w-]+/, '')));
        else if (name === 'font-face') {
          const family = splitTopLevel(text, ';').map((d) => d.match(/^\s*font-family\s*:([\s\S]*)$/i)?.[1]).find(Boolean);
          if (family) fonts.add(unquote(family));
        } else if (GROUPING_RULES.has(name)) {
          if (/prefers-color-scheme/i.test(prelude)) scheme = true;
          const where = at ? `${at} ${prelude}` : prelude;
          if (selector) declare(`${where} ${selector}`, text);
          walk(inner, where, selector);
        }
      } else if (prelude) {
        const resolved = selector ? nest(selector, prelude) : prelude;
        for (const name of classesOf(prelude)) classes.add(name);
        select(resolved);
        declare(at ? `${at} ${resolved}` : resolved, text);
        walk(inner, at, resolved);
      }
    }
  };
  walk(tree.rules, '', '');
  return {
    variables: [...variables].flatMap(([where, names]) => [...names].map(([name, value]) => ({ where, name, value }))),
    classes: [...classes],
    keyframes: [...keyframes],
    fonts: [...fonts],
    imports: importsOf(tree),
    themes: { valued, rootClasses, scheme }
  };
}

/** Themes in the order the canvas's switch shows them: light, dark, then the others as found */
function inOrder(values) {
  const unique = [...new Set(values)];
  return [...['light', 'dark'].filter((value) => unique.includes(value)), ...unique.filter((value) => value !== 'light' && value !== 'dark')];
}

// ---------------------------------------------------------------- pages and components

/** What a page or a component loads: its <link rel="stylesheet">s, <script src>s and <style> @imports */
function loads(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  const stylesheets = [];
  const scripts = [];
  const tags = html.replace(/(<(script|style)\b[^>]*>)[\s\S]*?<\/\2\s*>/gi, '$1');
  for (const [tag, name] of tags.matchAll(/<(link|script)\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    if (name.toLowerCase() === 'link' && /\bstylesheet\b/i.test(attrs.rel || '') && attrs.href) stylesheets.push(attrs.href);
    else if (name.toLowerCase() === 'script' && attrs.src) scripts.push(attrs.src);
  }
  for (const [, css] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) stylesheets.push(...importsOf(parseCss(css)));
  return { stylesheets, scripts };
}

const ATTRIBUTE_SELECTOR = /\[\s*([\w-]+)\s*(?:[~|^$*]?=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))(?:\s+[is])?)?\s*\]/gi;

/**
 * How a component is used, from its file: its attributes (the {{name}}s in its markup, the ones its
 * script reads, and the ones its CSS styles on the element: `&[positive]`, `&[size="lg"]`), its slots
 * and the example it starts with. And its markup, to find the components it uses.
 */
function readComponent(source) {
  const example = source.match(/^\s*<!--([\s\S]*?)-->/)?.[1].replace(/\s+/g, ' ').trim() || null;
  const css = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((match) => match[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const code = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs)).map((match) => match[2]).join('\n');
  const markup = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const found = new Map(); // name → { text, flag, values }
  const add = (name, kind, value) => {
    if (!found.has(name)) found.set(name, { values: new Set() });
    if (value !== undefined) found.get(name).values.add(value);
    else found.get(name)[kind] = true;
  };
  for (const [, name] of markup.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) add(name, 'text');
  for (const [, verb, , name] of code.matchAll(/\b(get|has)Attribute\(\s*(['"`])([^'"`]+)\2/g)) add(name, verb === 'has' ? 'flag' : 'text');
  for (const [, name] of code.matchAll(/\bdataset\.([A-Za-z_$][\w$]*)/g)) add(`data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, 'text');
  for (const [, selectors] of css.matchAll(/&((?:\[[^\]]*\])+)/g)) {
    for (const [, name, ...values] of selectors.matchAll(ATTRIBUTE_SELECTOR)) add(name, 'flag', values.find((v) => v !== undefined));
  }
  for (const [, name] of css.matchAll(/&:not\(\s*\[\s*([\w-]+)\s*\]/g)) add(name, 'flag');
  const slots = [...markup.matchAll(/<slot\b[^>]*>/gi)].map(([tag]) => attributes(tag).name || '');
  return {
    attributes: [...found].map(([name, { text, values }]) => {
      if (values.size) return { name, values: [...values] };
      return text ? { name } : { name, flag: true };
    }),
    slots: [...new Set(slots)],
    example,
    markup
  };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- the catalog

/**
 * What the designs in a folder share: the stylesheets and scripts they load (with what each local
 * stylesheet defines) and the components in its components/ (with how each is used, and where).
 *
 * @param {string} [dir=process.cwd()] The designs folder
 * @param {object} [options]
 * @param {string} [options.root] The folder the server serves from (`--root`), for links that
 *   start with "/" (default: the designs folder)
 * @returns {{dir: string, designs: string[], stylesheets: object[], scripts: object[], components: object[]}}
 *   Paths are from the designs folder. Each stylesheet, script and component has its `users`:
 *   `{ design }` (a file), `{ component }` (a tag) or `{ stylesheet }` (one that @imports it).
 */
export function buildCatalog(dir = process.cwd(), { root } = {}) {
  const designsDir = path.resolve(dir);
  if (!fs.statSync(designsDir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`There is no folder ${dir}`);
  const rootDir = root ? path.resolve(root) : designsDir;
  const fromDesigns = (file) => path.relative(designsDir, file).split(path.sep).join('/');

  // Where a link points: a URL as it is, a file by its path from the designs folder
  const locate = (href, from) => {
    href = href.trim();
    if (!href || /^(#|data:|about:|javascript:)/i.test(href)) return null;
    if (/^([a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return { key: href, path: href, external: true };
    let clean = href.replace(/[?#][\s\S]*$/, '');
    try {
      clean = decodeURIComponent(clean);
    } catch {
      // as it is
    }
    const file = clean.startsWith('/') ? path.join(rootDir, clean) : path.resolve(path.dirname(from), clean);
    return { key: file, path: fromDesigns(file), file };
  };
  const addUser = (entry, user) => {
    const [[kind, name]] = Object.entries(user);
    if (!entry.users.some((other) => other[kind] === name)) entry.users.push(user);
  };

  const stylesheets = new Map(); // URL or file → what it is and who loads it
  const hints = new Map(); // a local stylesheet's entry → what its themes could be (see readStylesheet)
  const addStylesheet = (where, user) => {
    if (!where) return;
    let entry = stylesheets.get(where.key);
    if (!entry) {
      entry = { path: where.path, users: [] };
      stylesheets.set(where.key, entry);
      const css = where.external ? null : read(where.file);
      if (where.external) entry.external = true;
      else if (css === null) entry.missing = true;
      else {
        const { imports, themes, ...defines } = readStylesheet(css);
        Object.assign(entry, defines);
        hints.set(entry, themes);
        for (const href of imports) addStylesheet(locate(href, where.file), { stylesheet: entry.path });
      }
    }
    if (user) addUser(entry, user);
  };
  const scripts = new Map();
  const addScript = (where, user) => {
    if (!where) return;
    if (!scripts.has(where.key)) {
      const entry = { path: where.path, users: [] };
      if (where.external) entry.external = true;
      else if (!fs.existsSync(where.file)) entry.missing = true;
      scripts.set(where.key, entry);
    }
    addUser(scripts.get(where.key), user);
  };

  const scanned = scanDesigns(designsDir);
  const designs = scanned.filter((design) => !design.variantOf).map((design) => design.file);
  const pages = designs.map((file) => {
    const full = path.join(designsDir, file);
    const html = (read(full) ?? '').replace(/<!--[\s\S]*?-->/g, '');
    const { stylesheets: hrefs, scripts: srcs } = loads(html);
    for (const href of hrefs) addStylesheet(locate(href, full), { design: file });
    for (const src of srcs) addScript(locate(src, full), { design: file });
    return [file, html];
  });

  const components = [];
  const markups = new Map();
  const componentsDir = path.join(designsDir, COMPONENTS_FOLDER);
  let names = [];
  try {
    names = fs.readdirSync(componentsDir).filter((name) => name.endsWith('.html') && isTagName(name.slice(0, -5))).sort(byName);
  } catch {
    // no components
  }
  for (const name of names) {
    const full = path.join(componentsDir, name);
    const source = read(full);
    if (source === null || isPage(source)) continue; // a whole page is a design
    const tag = name.slice(0, -5);
    const { markup, ...usage } = readComponent(source);
    components.push({ tag, file: `${COMPONENTS_FOLDER}/${name}`, ...usage, users: [] });
    markups.set(tag, markup);
    const { stylesheets: hrefs, scripts: srcs } = loads(source);
    for (const href of hrefs) addStylesheet(locate(href, full), { component: tag });
    for (const src of srcs) addScript(locate(src, full), { component: tag });
  }
  for (const component of components) {
    const used = new RegExp(`<${escapeRegExp(component.tag)}[\\s/>]`, 'i');
    for (const [file, html] of pages) if (used.test(html)) component.users.push({ design: file });
    for (const [tag, markup] of markups) if (tag !== component.tag && used.test(markup)) component.users.push({ component: tag });
  }

  // The stylesheets at the top of the folder are there to be shared, even before a design links them
  const top = fs.readdirSync(designsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.css$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort(byName);
  for (const name of top) addStylesheet({ key: path.join(designsDir, name), path: name, file: path.join(designsDir, name) });

  return {
    dir: designsDir,
    designs,
    stylesheets: [...stylesheets.values()],
    scripts: [...scripts.values()],
    components,
    themes: findThemes(designsDir, scanned, hints)
  };
}

/**
 * The themes the designs have: as designs.json says (how they apply, and which), else a design (its
 * <meta name="htmlboard:themes">), else as the stylesheets do: the values their selectors give the
 * attribute (data-theme, unless said), and light and dark when they follow the system's. Null when
 * there are none.
 */
function findThemes(designsDir, scanned, hints) {
  let config = null;
  let said = null;
  try {
    config = normalizeThemes(JSON.parse(fs.readFileSync(path.join(designsDir, 'designs.json'), 'utf8')).themes) ?? null;
    if (config) said = 'designs.json';
  } catch {
    // No designs.json, or not one that can be read
  }
  if (!config) {
    const design = scanned.find((d) => d.themes);
    if (design) [config, said] = [design.themes, design.file];
  }
  const attribute = config?.attribute || 'data-theme';
  if (config?.values.length) return { attribute, values: inOrder(config.values), byAttribute: true, scheme: false, from: [said] };
  const values = [];
  const from = said ? [said] : [];
  let byAttribute = false;
  let scheme = false;
  for (const [entry, hint] of hints) {
    const found = attribute === 'class' ? [...hint.rootClasses] : [...(hint.valued.get(attribute) ?? [])];
    if (found.length) byAttribute = true;
    if (hint.scheme) scheme = true;
    if (found.length || hint.scheme) from.push(entry.path);
    values.push(...found);
  }
  if (scheme) values.push('light', 'dark');
  return values.length ? { attribute, values: inOrder(values), byAttribute, scheme, from } : null;
}

// ---------------------------------------------------------------- as text

/** `head`, the items after it (the first MOST_ITEMS) and `end`, wrapped at WIDTH, indented under head */
function wrap(head, items, end) {
  if (items.length > MOST_ITEMS) items = [...items.slice(0, MOST_ITEMS), `… and ${items.length - MOST_ITEMS} more`];
  if (end) items = [...items, end];
  const indent = ' '.repeat(head.length - head.trimStart().length + 2);
  const lines = [];
  let line = head;
  let count = 0;
  for (const item of items) {
    if (count && line.length + 1 + item.length > WIDTH) {
      lines.push(line);
      line = indent + item;
    } else {
      line += ` ${item}`;
    }
    count++;
  }
  lines.push(line);
  return lines;
}

/** Who loads or uses something: the designs (named when few), components and stylesheets */
function describeUsers(users, total, none) {
  if (!users.length) return none;
  const parts = [];
  const designs = users.filter((user) => user.design).map((user) => user.design);
  if (designs.length === total && total > 1) parts.push(`all ${total} designs`);
  else if (designs.length > MOST_NAMED) parts.push(`${designs.length} designs`);
  else if (designs.length) parts.push(`${designs.length} design${designs.length === 1 ? '' : 's'}: ${designs.join(', ')}`);
  const components = users.filter((user) => user.component).map((user) => `<${user.component}>`);
  if (components.length) parts.push(components.join(' '));
  const sheets = users.filter((user) => user.stylesheet).map((user) => user.stylesheet);
  if (sheets.length) parts.push(`imported by ${sheets.join(', ')}`);
  return parts.join('; ');
}

const cut = (value) => (value.length > LONGEST_VALUE ? `${value.slice(0, LONGEST_VALUE - 1)}…` : value);

/** How a component is written: its tag with its attributes, then what goes inside */
function signature({ tag, attributes: attrs, slots }) {
  const names = attrs.map(({ name, values, flag }) => (values ? `${name}=${values.join('|')}` : flag ? `[${name}]` : name));
  const inside = slots.map((slot) => (slot ? `slot="${slot}"` : 'children'));
  return `<${[tag, ...names].join(' ')}>${inside.length ? ` + ${inside.join(', ')}` : ''}`;
}

/**
 * The catalog as text, a few lines per stylesheet, script and component (what `htmlboard catalog`
 * prints).
 *
 * @param {ReturnType<typeof buildCatalog>} catalog
 * @param {object} [options]
 * @param {string} [options.name] How to call the designs folder (default: its full path)
 */
export function formatCatalog(catalog, { name = catalog.dir } = {}) {
  const total = catalog.designs.length;
  const lines = [`${name}: ${total ? `${total} design${total === 1 ? '' : 's'}` : 'no designs yet'}.`];
  if (catalog.stylesheets.length || catalog.scripts.length || catalog.components.length) {
    lines[0] += ' Paths below are from this folder.';
  } else if (total) {
    lines.push('', 'Nothing shared yet: no stylesheet, script or component.');
  }
  if (catalog.themes) {
    const { attribute, values, byAttribute, scheme, from } = catalog.themes;
    const how = [
      byAttribute && (attribute === 'class' ? 'classes on <html>' : `${attribute} on <html>`),
      scheme && `${byAttribute ? 'and ' : ''}the system’s light and dark modes`,
    ].filter(Boolean).join(', ');
    lines.push('', `Themes: ${values.join(', ')} (${how}${from.length ? `; in ${from.join(', ')}` : ''}): check --themes all, shot --theme <name>`);
  }
  if (catalog.stylesheets.length) {
    lines.push('', 'Stylesheets');
    for (const sheet of catalog.stylesheets) {
      lines.push(`  ${sheet.path}${sheet.missing ? ' (not found)' : ''} · ${describeUsers(sheet.users, total, 'not linked yet')}`);
      const groups = new Map();
      for (const { where, name: variable, value } of sheet.variables ?? []) {
        if (!groups.has(where)) groups.set(where, []);
        groups.get(where).push(`${variable}: ${cut(value)};`);
      }
      for (const [where, declarations] of groups) lines.push(...wrap(`    ${where} {`, declarations, '}'));
      if (sheet.classes?.length) lines.push(...wrap('    classes', sheet.classes.map((className) => `.${className}`)));
      if (sheet.keyframes?.length) lines.push(...wrap('    @keyframes', sheet.keyframes.map((n, i, all) => (i < all.length - 1 ? `${n},` : n))));
      if (sheet.fonts?.length) lines.push(...wrap('    @font-face', sheet.fonts.map((n, i, all) => (i < all.length - 1 ? `${n},` : n))));
    }
  }
  if (catalog.scripts.length) {
    lines.push('', 'Scripts');
    for (const script of catalog.scripts) {
      lines.push(`  ${script.path}${script.missing ? ' (not found)' : ''} · ${describeUsers(script.users, total)}`);
    }
  }
  if (catalog.components.length) {
    lines.push('', `Components (${COMPONENTS_FOLDER}/)`);
    for (const component of catalog.components) {
      lines.push(`  ${signature(component)} · ${describeUsers(component.users, total, 'not used yet')}`);
      if (component.example) lines.push(`    e.g. ${component.example}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
