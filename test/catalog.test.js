import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCatalog, formatCatalog } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'htmlboard.js');
const TEMPLATES_DIR = path.join(__dirname, '..', 'src', 'templates');

// Who uses something, in one line: designs by file, components by tag, stylesheets by path
const who = (entry) => entry.users.map((user) => user.design ?? (user.component ? `<${user.component}>` : `@${user.stylesheet}`)).join(' ');

describe('The catalog of the sample designs', () => {
  const catalog = buildCatalog(TEMPLATES_DIR);

  test('styles.css, linked by every design, with its variables and classes; components.js', () => {
    assert.equal(catalog.designs.length, 4);
    assert.deepEqual(catalog.stylesheets.map((sheet) => [sheet.path, sheet.users.length]), [['styles.css', 4]]);
    const [styles] = catalog.stylesheets;
    assert.deepEqual(styles.variables.find((v) => v.name === '--accent'), { where: ':root', name: '--accent', value: '#6366f1' });
    for (const name of ['btn', 'btn-primary', 'card', 'badge-emerald', 'table']) assert.ok(styles.classes.includes(name), name);
    assert.deepEqual(catalog.scripts.map((script) => [script.path, script.users.length]), [['components.js', 4]]);
  });

  test('each component: how it is written, an example, and where it is used', () => {
    const text = formatCatalog(catalog, { name: 'templates' });
    assert.match(text, /^templates: 4 designs\. Paths below are from this folder\.\n/);
    assert.match(text, /^ {2}<app-sidebar active> · 2 designs: 01-screens\/01-dashboard\.html, 01-screens\/02-customers\.html$/m);
    assert.match(text, /^ {2}<app-topbar search> \+ children · /m);
    assert.match(text, /^ {2}<stat-card label value trend \[warn\]> · 2 designs: 01-screens\/01-dashboard\.html, 02-ui-kit\/01-overview\.html$/m);
    assert.match(text, /^ {2}<tx-item icon name meta amount \[positive\]> · /m);
    assert.match(text, /^ {4}e\.g\. <tx-item icon="💼" name="Client Invoice #1042"/m);
  });

  test('is much shorter than the files it stands for', () => {
    const files = ['styles.css', ...fs.readdirSync(path.join(TEMPLATES_DIR, 'components')).map((file) => `components/${file}`)];
    const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(TEMPLATES_DIR, file)).size, 0);
    const text = formatCatalog(catalog);
    assert.ok(Buffer.byteLength(text) * 2 < bytes, `${Buffer.byteLength(text)} bytes for ${bytes}`);
  });
});

describe('The catalog of any project', () => {
  let project;
  let designs;
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    fs.writeFileSync(path.join(project, file), content);
  };

  before(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-catalog-'));
    designs = path.join(project, 'designs');
    write('css/site.css', '.site-header { color: red; }\n');
    write('designs/theme/base.css', `@import "tokens.css";
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
:root { --space: 8px; --shadow: 0 1px 2px rgb(0 0 0 / 0.1), 0 8px 24px rgb(0 0 0 / 0.1) }
[data-theme="dark"] { --bg: #000; }
@media (prefers-color-scheme: dark) { :root { --bg: #111 } }
@media (min-width: 40.5em) { .grid { display: grid } }
a[href$=".pdf"], .doc-link::after { content: "{.not-a-class}" }
.btn:hover, .btn.is-active { color: blue }
.card { --pad: 16px; padding: var(--pad); &.big { --pad: 24px } .title { font-weight: 700 } }
@keyframes pulse { from { opacity: 0 } 50.5% { opacity: .5 } to { opacity: 1 } }
@font-face { font-family: "Brand Sans"; src: url(brand.woff2) }
/* .commented-out { } */
`);
    write('designs/theme/tokens.css', ':root { --icon: url("data:image/svg+xml;utf8,<svg/>;"); --accent: #e11d48 }\n');
    write('designs/extra.css', '.unlinked-yet { color: green }\n');
    write('designs/01-shop/01-cart.html', `<!DOCTYPE html><html><head><title>Cart</title>
<meta name="htmlboard:variant" content="?theme=dark · dark">
<link rel="stylesheet" href="../theme/base.css?v=2">
<link rel="stylesheet" href="/theme/base.css">
<link rel=stylesheet href="https://cdn.example.com/kit.css">
<link rel="stylesheet" href="../../css/site.css">
<link rel="stylesheet" href="missing.css">
<!-- <link rel="stylesheet" href="commented.css"> -->
<script src="https://cdn.example.com/chart.js"></script>
<script type="module" src="../components.js"></script>
<style>@import url("https://fonts.example.com/serif.css"); .x { color: red }</style>
<script>const s = '<link rel="stylesheet" href="in-a-string.css">';</script>
</head><body><x-card title="Plan" size="lg"><p>Body</p></x-card></body></html>
`);
    write('designs/01-shop/02-checkout.html', `<!DOCTYPE html><html><head><title>Checkout</title><style>body { margin: 0 }</style></head>
<body><p>&lt;x-card&gt; is only text here</p></body></html>
`);
    write('designs/components/x-card.html', `<!--
  <x-card title="Plan" size="lg">
    <p>Body</p> <button slot="actions">Go</button>
  </x-card>
-->
<link rel="stylesheet" href="../theme/base.css">
<script src="https://cdn.example.com/lib.js"></script>
<h2>{{ title }}</h2>
<x-badge label="New"></x-badge>
<slot></slot>
<footer><slot name="actions"><button>Default</button></slot></footer>
<style>
  &[size="lg"] h2 { font-size: 24px }
  &[size=sm] h2 { font-size: 12px }
  &:not([flat]) { box-shadow: var(--shadow) }
  /* &[commented] { } */
</style>
<script>
  if (this.hasAttribute('open')) this.classList.add('open');
  const id = this.dataset.cardId;
</script>
`);
    write('designs/components/x-badge.html', '<span class="badge">{{label}}</span>\n');
    write('designs/components/unused-thing.html', '<!-- <unused-thing></unused-thing> -->\n<p>Nobody uses me</p>\n');
    write('designs/components/old-page.html', '<!DOCTYPE html><html><head><title>Old page</title></head><body>A design</body></html>\n');
    write('designs/components/README.html', '<p>Not a tag name</p>\n');
  });

  after(() => fs.rmSync(project, { recursive: true, force: true }));

  test('the stylesheets designs and components load, whatever their name and folder', () => {
    const catalog = buildCatalog(designs);
    // A variant isn't one more design; a whole page in components/ is one
    assert.deepEqual(catalog.designs, ['01-shop/01-cart.html', '01-shop/02-checkout.html', 'components/old-page.html']);
    assert.deepEqual(catalog.stylesheets.map((sheet) => [sheet.path, who(sheet), sheet.external ? 'url' : sheet.missing ? 'missing' : 'file']), [
      ['theme/base.css', '01-shop/01-cart.html <x-card>', 'file'],
      ['theme/tokens.css', '@theme/base.css', 'file'],
      ['https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap', '@theme/base.css', 'url'],
      ['https://cdn.example.com/kit.css', '01-shop/01-cart.html', 'url'],
      ['../css/site.css', '01-shop/01-cart.html', 'file'],
      ['01-shop/missing.css', '01-shop/01-cart.html', 'missing'],
      ['https://fonts.example.com/serif.css', '01-shop/01-cart.html', 'url'],
      ['extra.css', '', 'file'] // at the top of the folder: there to be shared
    ]);
    assert.deepEqual(catalog.scripts.map((script) => [script.path, who(script), script.missing ? 'missing' : 'found']), [
      ['https://cdn.example.com/chart.js', '01-shop/01-cart.html', 'found'],
      ['components.js', '01-shop/01-cart.html', 'missing'],
      ['https://cdn.example.com/lib.js', '<x-card>', 'found']
    ]);
    // Links that start with "/" start from the folder the canvas serves (--root)
    const fromProject = buildCatalog(designs, { root: project });
    assert.ok(fromProject.stylesheets.some((sheet) => sheet.path === '../theme/base.css' && sheet.missing));
  });

  test('what a stylesheet defines: variables by selector, classes, keyframes and fonts', () => {
    const [base, tokens] = buildCatalog(designs).stylesheets;
    assert.deepEqual(base.variables.map(({ where, name, value }) => `${where} ${name}: ${value}`), [
      ':root --space: 8px',
      ':root --shadow: 0 1px 2px rgb(0 0 0 / 0.1), 0 8px 24px rgb(0 0 0 / 0.1)',
      '[data-theme="dark"] --bg: #000',
      '@media (prefers-color-scheme: dark) :root --bg: #111',
      '.card --pad: 16px',
      '.card.big --pad: 24px'
    ]);
    // Not the ".pdf" of an attribute selector, a string's or a comment's
    assert.deepEqual(base.classes, ['grid', 'doc-link', 'btn', 'is-active', 'card', 'big', 'title']);
    assert.deepEqual(base.keyframes, ['pulse']);
    assert.deepEqual(base.fonts, ['Brand Sans']);
    assert.equal(tokens.variables[0].value, 'url("data:image/svg+xml;utf8,<svg/>;")');
  });

  test('components: their attributes, slots and example, and who uses them', () => {
    const { components } = buildCatalog(designs);
    assert.deepEqual(components.map((c) => [c.tag, who(c) || '-']), [
      ['unused-thing', '-'],
      ['x-badge', '<x-card>'],
      ['x-card', '01-shop/01-cart.html']
    ]);
    const card = components[2];
    assert.deepEqual(card.attributes, [
      { name: 'title' },
      { name: 'open', flag: true },
      { name: 'data-card-id' },
      { name: 'size', values: ['lg', 'sm'] },
      { name: 'flat', flag: true }
    ]);
    assert.deepEqual(card.slots, ['', 'actions']);
    assert.equal(card.example, '<x-card title="Plan" size="lg"> <p>Body</p> <button slot="actions">Go</button> </x-card>');
    assert.equal(components[1].example, null);

    const text = formatCatalog(buildCatalog(designs), { name: 'designs' });
    assert.match(text, /^ {2}<x-card title \[open\] data-card-id size=lg\|sm \[flat\]> \+ children, slot="actions" · 1 design: 01-shop\/01-cart\.html$/m);
    assert.match(text, /^ {2}<unused-thing> · not used yet$/m);
    assert.match(text, /^ {2}extra\.css · not linked yet$/m);
    assert.match(text, /^ {2}01-shop\/missing\.css \(not found\) · /m);
    assert.match(text, /^ {4}@media \(prefers-color-scheme: dark\) :root \{ --bg: #111; \}$/m);
  });

  test('a folder that shares nothing, or has no designs, says so', () => {
    const dir = path.join(project, 'plain');
    fs.mkdirSync(dir);
    assert.equal(formatCatalog(buildCatalog(dir), { name: 'plain' }), 'plain: no designs yet.\n');
    fs.writeFileSync(path.join(dir, 'one.html'), '<!DOCTYPE html><title>One</title><style>p { color: red }</style>');
    assert.equal(formatCatalog(buildCatalog(dir), { name: 'plain' }),
      'plain: 1 design.\n\nNothing shared yet: no stylesheet, script, icon or component.\n');
  });

  test('CLI: htmlboard catalog <dir>', () => {
    const out = execFileSync(process.execPath, [CLI, 'catalog', 'designs'], { cwd: project, encoding: 'utf8' });
    assert.match(out, /^designs: 3 designs\. /);
    assert.match(out, /^Components \(components\/\)$/m);
    assert.doesNotMatch(out, /\x1b\[/); // plain text, for agents
    assert.equal(spawnSync(process.execPath, [CLI, 'catalog', '--bogus'], { cwd: project }).status, 1);
    assert.equal(spawnSync(process.execPath, [CLI, 'catalog', 'nope'], { cwd: project }).status, 1);
  });
});
