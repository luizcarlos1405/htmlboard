import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile, readLock, writeLock, compareCopy } from './lock.js';

// Components: every file in a designs folder's components/ is a custom element named after it
// (components/tx-item.html is <tx-item>), built in the page by components.js, the script beside
// the folder that designs load like they link styles.css. A component file is a piece of HTML that
// starts with a comment showing how to use it; that example is also its preview on the canvas.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The folder of components, at the top of the designs folder */
export const COMPONENTS_FOLDER = 'components';
/** The script that turns them into custom elements, beside the folder */
export const COMPONENTS_SCRIPT = 'components.js';
/** The script as htmlboard ships it */
export const COMPONENTS_SCRIPT_SOURCE = path.join(__dirname, 'templates', COMPONENTS_SCRIPT);
/** A component's preview on the canvas is this wide, unless its file says otherwise */
export const PREVIEW_WIDTH = 480;

const RESERVED = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri',
  'font-face-format', 'font-face-name', 'missing-glyph']);

/** A name a custom element can have: lowercase, starting with a letter, with a hyphen */
export function isTagName(name) {
  return /^[a-z][-.0-9_a-z·À-\u{EFFFF}]*$/u.test(name) && name.includes('-') && !RESERVED.has(name);
}

/** A whole page (<!DOCTYPE html> or <html> first), not a piece of one: a design, even in components/ */
export function isPage(html) {
  return /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html|<html[\s>])/i.test(html);
}

/** How a component is used: the comment its file starts with, else the bare element */
export function componentExample(html, tag) {
  const comment = html.match(/^\s*<!--([\s\S]*?)-->/);
  return comment?.[1].trim() || `<${tag}></${tag}>`;
}

/**
 * The page that shows a component on the canvas (components/<tag>.html?preview): its example, with
 * the stylesheets at the top of the designs folder and components.js. Null for any other file.
 */
export function componentPreview(designsDir, file) {
  if (path.dirname(file) !== path.join(designsDir, COMPONENTS_FOLDER) || !/\.html$/.test(file)) return null;
  const tag = path.basename(file, '.html');
  if (!isTagName(tag)) return null;
  let html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (isPage(html)) return null;
  const stylesheets = fs.readdirSync(designsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.css$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>&lt;${tag}&gt;</title>
${stylesheets.map((name) => `  <link rel="stylesheet" href="../${encodeURI(name)}">\n`).join('')}  <script type="module" src="../${COMPONENTS_SCRIPT}"></script>
  <style>body { display: grid; gap: 16px; margin: 0; padding: 24px; }</style>
</head>
<body>
${componentExample(html, tag)}
</body>
</html>
`;
}

/**
 * Add components.js (and the components/ folder) to a designs folder, and record it in the folder's
 * .htmlboard-lock.json. A components.js nobody changed since it was added is updated. Without `force`,
 * one is kept when it was changed locally ('edited'), when the lock has no record of it, as with one
 * added by htmlboard 0.10.0 or older ('unrecorded'), and when a newer htmlboard added it ('newer').
 *
 * @param {object} [options]
 * @param {string} [options.dir=process.cwd()] The designs folder
 * @param {boolean} [options.force=false] Replace a components.js it would keep
 * @returns {{path: string, status: 'installed'|'updated'|'unchanged'|'skipped',
 *   reason?: 'edited'|'unrecorded'|'newer'}} A skipped components.js says why in `reason`
 */
export function installComponents({ dir = process.cwd(), force = false } = {}) {
  const designsDir = path.resolve(dir);
  const dest = path.join(designsDir, COMPONENTS_SCRIPT);
  const bundled = { [COMPONENTS_SCRIPT]: hashFile(COMPONENTS_SCRIPT_SOURCE) };
  const lock = readLock(designsDir);
  const locked = lock?.files[COMPONENTS_SCRIPT];
  const result = fs.existsSync(dest)
    ? compareCopy({
      current: { [COMPONENTS_SCRIPT]: hashFile(dest) },
      bundled,
      locked: locked ? { [COMPONENTS_SCRIPT]: locked } : null,
      lockedBy: lock?.htmlboard,
      force
    })
    : { status: 'installed' };
  fs.mkdirSync(path.join(designsDir, COMPONENTS_FOLDER), { recursive: true });
  if (result.status === 'installed' || result.status === 'updated') fs.writeFileSync(dest, fs.readFileSync(COMPONENTS_SCRIPT_SOURCE));
  // Locked once written, and when up to date but not locked yet (added by an older htmlboard), so the
  // next upgrade can update it. What else the lock lists stays.
  if (result.status !== 'skipped' && locked !== bundled[COMPONENTS_SCRIPT]) writeLock(designsDir, { ...lock?.files, ...bundled });
  return { path: dest, ...result };
}
