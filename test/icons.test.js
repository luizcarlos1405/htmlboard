import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addIcons, formatIcons, symbolOf, buildCatalog, formatCatalog, formatReport, SPRITE } from '../src/index.js';
import { designsFolderOf } from '../src/canvases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'htmlboard.js');

const USERS = `<!-- @license lucide-static v1.77.0 - ISC -->
<svg
  class="lucide lucide-users"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
  <circle cx="9" cy="7" r="4" />
</svg>
`;
const SEARCH = USERS.replace('lucide-users', 'lucide-search').replace(/<path[\s\S]*?\/>\n  <circle[^>]*\/>/, '<circle cx="11" cy="11" r="8" />');
const LICENSE = 'ISC License\n\nCopyright (c) 2026 Lucide Icons and Contributors\n\n---\n\nThe MIT License (MIT) (for the icons listed above)\n';
const TAGS = { 'user-plus': ['person', 'add', 'new'], 'user-round-plus': ['person', 'add'], users: ['group', 'people'], search: ['find', 'magnifier'] };

/** A stand-in for the CDN and the registry: what each URL answers, and the URLs asked for */
function fakeFetch(version = '1.77.0', asked = []) {
  return async (url) => {
    asked.push(url);
    const reply = (status, body) => ({ ok: status === 200, status, text: async () => body, json: async () => JSON.parse(body) });
    if (url === 'https://registry.npmjs.org/lucide-static/latest') return reply(200, JSON.stringify({ version }));
    const base = `https://cdn.jsdelivr.net/npm/lucide-static@${version}/`;
    if (!url.startsWith(base)) return reply(404, 'Not found');
    const file = url.slice(base.length);
    if (file === 'icons/users.svg') return reply(200, USERS);
    if (file === 'icons/search.svg') return reply(200, SEARCH);
    if (file === 'tags.json') return reply(200, JSON.stringify(TAGS));
    if (file === 'LICENSE') return reply(200, LICENSE);
    return reply(404, 'Not found');
  };
}

const comments = (svg) => [...svg.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);

describe('htmlboard icons', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-icons-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('an icon becomes a symbol named after it, with the viewBox, stroke and fill of its set', () => {
    assert.equal(symbolOf('users', USERS), [
      '  <symbol id="users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
      '    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />',
      '    <circle cx="9" cy="7" r="4" />',
      '  </symbol>',
    ].join('\n'));
    assert.throws(() => symbolOf('nope', 'Not found'), /nope isn't an SVG/);
  });

  test('adding makes the sprite, with the set, its version and its license; icons already there are kept', async () => {
    let result = await addIcons(['users'], { dir, fetch: fakeFetch('1.76.0') });
    assert.deepEqual(result, { path: path.join(dir, SPRITE), added: ['users'], had: [], unknown: [], set: 'lucide', version: '1.76.0' });
    let svg = fs.readFileSync(path.join(dir, SPRITE), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg">\n  <!-- Lucide icons \(lucide-static 1\.76\.0\), from https:\/\/lucide\.dev\/icons/);
    assert.match(svg, /Copyright \(c\) 2026 Lucide Icons and Contributors/);
    for (const comment of comments(svg)) assert.doesNotMatch(comment, /--/, 'a comment can\'t hold "--": the license\'s --- is spaced out');
    assert.match(svg, /<symbol id="users" viewBox="0 0 24 24"/);

    const asked = [];
    result = await addIcons(['users', 'search', 'search'], { dir, fetch: fakeFetch('1.77.0', asked) });
    assert.deepEqual(result.added, ['search']);
    assert.deepEqual(result.had, ['users']);
    assert.ok(!asked.some((url) => url.endsWith('/users.svg')), 'an icon it has is not fetched again');
    svg = fs.readFileSync(path.join(dir, SPRITE), 'utf8');
    assert.equal(svg.match(/<symbol /g).length, 2);
    assert.equal(svg.match(/<!-- Lucide icons/g).length, 1, 'one note for the set…');
    assert.match(svg, /lucide-static 1\.77\.0/, '…with the version of the newest icons');
    assert.ok(svg.indexOf('id="users"') < svg.indexOf('id="search"'), 'new icons go after the others');
    assert.match(svg, /<\/symbol>\n<\/svg>\n$/);

    const asked2 = [];
    result = await addIcons(['users'], { dir, fetch: fakeFetch('1.77.0', asked2) });
    assert.deepEqual(asked2, [], 'nothing to add: nothing fetched');
    assert.deepEqual(result.had, ['users']);
  });

  test('a sprite made by hand keeps what it has and gets the note', async () => {
    fs.writeFileSync(path.join(dir, SPRITE), '<svg xmlns="http://www.w3.org/2000/svg" fill="none">\n  <symbol id="logo" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>\n</svg>\n');
    await addIcons(['search'], { dir, fetch: fakeFetch() });
    const svg = fs.readFileSync(path.join(dir, SPRITE), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" fill="none">\n  <!-- Lucide icons/);
    assert.match(svg, /<symbol id="logo"[\s\S]*<symbol id="search"/);
  });

  test("a name the set doesn't have is said, with names close to it; the others are added", async () => {
    const result = await addIcons(['user-add', 'serch', 'users'], { dir, fetch: fakeFetch() });
    assert.deepEqual(result.added, ['users']);
    assert.deepEqual(result.unknown, [
      { name: 'user-add', suggestions: ['user-plus', 'user-round-plus', 'users'] },
      { name: 'serch', suggestions: ['search'] },
    ]);
    assert.equal(formatIcons(result, { name: 'designs/icons.svg' }), [
      '  ✓ added users to designs/icons.svg (Lucide 1.77.0)',
      '  ! there is no user-add in Lucide: user-plus, user-round-plus, users? (https://lucide.dev/icons)',
      '  ! there is no serch in Lucide: search? (https://lucide.dev/icons)',
      '',
      '  Draw one as <svg class="icon"><use href="icons.svg#users"/></svg> (../icons.svg from a folder in it), sized in CSS.',
      '',
    ].join('\n'));
  });

  test('without the network, or with names that are none, it says so and writes nothing', async () => {
    const offline = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND registry.npmjs.org') });
    };
    await assert.rejects(addIcons(['users'], { dir, fetch: offline }), /Couldn't reach registry\.npmjs\.org .*ENOTFOUND.*needs the network/);
    await assert.rejects(addIcons(['Users', 'arrow_up'], { dir, fetch: fakeFetch() }), /Users, arrow_up aren't icon names/);
    await assert.rejects(addIcons(['users'], { dir, set: 'feather', fetch: fakeFetch() }), /There is no icon set "feather": use lucide/);
    assert.ok(!fs.existsSync(path.join(dir, SPRITE)));
  });

  test('the catalog lists the icons of the sprites the designs use; a big one, only the ones used', () => {
    const designs = path.join(dir, 'designs');
    fs.mkdirSync(path.join(designs, '01-app'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules', 'set'), { recursive: true });
    fs.writeFileSync(path.join(designs, SPRITE), `<svg xmlns="http://www.w3.org/2000/svg">\n${symbolOf('users', USERS)}\n${symbolOf('search', SEARCH)}\n</svg>\n`);
    const big = Array.from({ length: 150 }, (_, i) => `<symbol id="icon-${i}" viewBox="0 0 24 24"/>`).join('');
    fs.writeFileSync(path.join(dir, 'node_modules', 'set', 'sprite.svg'), `<svg xmlns="http://www.w3.org/2000/svg">${big}</svg>`);
    fs.writeFileSync(path.join(designs, '01-app', '01-home.html'), `<!DOCTYPE html><title>Home</title>
<svg class="icon"><use href="../icons.svg#users"/></svg>
<svg class="icon"><use xlink:href="/node_modules/set/sprite.svg#icon-7"></use></svg>
<svg class="icon"><use href="/node_modules/set/sprite.svg#icon-12"></use></svg>`);
    const catalog = buildCatalog(designs, { root: dir });
    assert.deepEqual(catalog.icons.map(({ path: file, icons, used }) => [file, icons.length, used]), [
      ['icons.svg', 2, ['users']],
      ['../node_modules/set/sprite.svg', 150, ['icon-7', 'icon-12']],
    ]);
    const text = formatCatalog(catalog, { name: 'designs' });
    assert.match(text, /\nIcons \(<svg class="icon"><use href="icons\.svg#name"\/><\/svg>; add more: htmlboard icons add <names>\)\n  icons\.svg \(2 icons\) · 1 design: 01-app\/01-home\.html\n    users search\n  \.\.\/node_modules\/set\/sprite\.svg \(150 icons\) · 1 design: 01-app\/01-home\.html\n    used \(2\): icon-7 icon-12\n/);
  });

  test('an icons.svg at the top marks the designs folder, as styles.css does', () => {
    const designs = path.join(dir, 'designs');
    fs.mkdirSync(path.join(designs, '01-app'), { recursive: true });
    fs.writeFileSync(path.join(designs, SPRITE), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(designs, '01-app', '01-home.html'), '<!DOCTYPE html><title>Home</title>');
    assert.equal(designsFolderOf(path.join(designs, '01-app', '01-home.html')), designs);
  });

  test("the check says which icons a sprite doesn't have", () => {
    const report = {
      dir: '/designs',
      root: '/designs',
      designs: [{
        file: '01-app/01-home.html',
        title: 'Home',
        problems: [
          { level: 'error', kind: 'icon', path: '/icons.svg', id: 'user-plus2', count: 2 },
          { level: 'error', kind: 'icon', id: 'local-star' },
        ],
      }],
    };
    assert.equal(formatReport(report), `Checked 1 design in /designs: 1 with problems.

01-app/01-home.html · Home
  error  missing icon: icons.svg#user-plus2 (<use>) (2 times)
  error  missing icon: #local-star, in the page (<use>)
`);
  });

  test('CLI: icons without add shows how; add needs names that are names', async () => {
    const run = (args) => new Promise((resolve) => execFile(process.execPath, [CLI, 'icons', ...args], { cwd: dir },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
    let out = await run([]);
    assert.equal(out.code, 0);
    assert.match(out.stdout, /htmlboard icons add <names>/);
    out = await run(['add']);
    assert.equal(out.code, 2);
    assert.match(out.stderr, /Say which icons to add/);
    out = await run(['add', 'Not_A_Name']);
    assert.equal(out.code, 2);
    assert.match(out.stderr, /Not_A_Name isn't an icon name/);
    out = await run(['remove', 'users']);
    assert.equal(out.code, 2);
    assert.match(out.stderr, /Unknown command: icons remove/);
  });
});
