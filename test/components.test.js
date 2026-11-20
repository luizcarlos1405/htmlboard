import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDesignsManifest, scanDesigns, startServer, installComponents, LOCK_FILE } from '../src/index.js';
import { isTagName, isPage, componentExample, COMPONENTS_SCRIPT_SOURCE } from '../src/components.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'htmlboard.js');
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/**
 * Another htmlboard release, made in dir: this package's components modules and components.js, at
 * `version`, with a line added to components.js. Returns its installComponents.
 */
async function release(dir, version, line = '// A line from another release.') {
  fs.mkdirSync(path.join(dir, 'src', 'templates'), { recursive: true });
  for (const file of ['components.js', 'lock.js']) fs.copyFileSync(path.join(ROOT, 'src', file), path.join(dir, 'src', file));
  fs.writeFileSync(path.join(dir, 'src', 'templates', 'components.js'), `${fs.readFileSync(COMPONENTS_SCRIPT_SOURCE, 'utf8')}${line}\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version, type: 'module' }));
  return (await import(pathToFileURL(path.join(dir, 'src', 'components.js')).href)).installComponents;
}

const page = (head = '', title = 'Page') => `<!doctype html>\n<html>\n<head>\n  <title>${title}</title>\n${head}</head>\n<body><main>x</main></body>\n</html>\n`;
const lines = (manifest) => manifest.sections.flatMap((s) => s.artboards.map((b) =>
  `${s.name} | ${b.title} | ${b.file} | ${b.width}x${b.height ?? '-'} | ${b.category ?? '-'}`));

describe('Component files', () => {
  test('a component is named like a custom element: lowercase, a hyphen', () => {
    for (const name of ['tx-item', 'app-sidebar', 'x-1', 'stat-card.v2', 'ação-item']) assert.ok(isTagName(name), name);
    for (const name of ['card', 'Tx-Item', '01-tx-item', '-tx', 'font-face', 'tx item']) assert.ok(!isTagName(name), name);
  });

  test('a whole page starts with <!doctype html> or <html>; a component is a piece of one', () => {
    assert.ok(isPage('<!DOCTYPE html>\n<html>…'));
    assert.ok(isPage('﻿<!-- note -->\n<html lang="en">…'));
    assert.ok(!isPage('<!-- <tx-item></tx-item> -->\n<div>{{name}}</div>'));
    assert.ok(!isPage('<div><iframe srcdoc="<!doctype html><html>"></iframe></div>'));
  });

  test('its first comment shows how to use it', () => {
    assert.equal(componentExample('  <!-- <tx-item name="Tea"></tx-item> -->\n<b>{{name}}</b>', 'tx-item'), '<tx-item name="Tea"></tx-item>');
    assert.equal(componentExample('<b>{{name}}</b>\n<!-- later -->', 'tx-item'), '<tx-item></tx-item>');
  });
});

describe('Components on the canvas', () => {
  let dir;
  const write = (file, html) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), html);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-components-'));
    write('cover.html', page('', 'Cover'));
    write('01-screens/01-home.html', page('  <meta name="htmlboard" content="width=390, height=844">\n', 'Home'));
    write('components/tx-item.html', '<!-- <tx-item name="Tea"></tx-item> -->\n<b>{{name}}</b>\n<svg><title>Icon</title></svg>\n');
    write('components/app-bar.html', '<!-- <app-bar></app-bar> -->\n<meta name="htmlboard" content="width=1280">\n<nav><slot></slot></nav>\n');
    write('components/old-board.html', page('', 'Old board')); // a whole page: still a design
    write('components/card.html', '<div>no hyphen, no component</div>');
    write('01-screens/components/part.html', '<div>a section of designs may be called components</div>');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('components aren\'t designs, unless designs.json shows them', () => {
    assert.deepEqual(scanDesigns(dir).map((d) => d.file), [
      'cover.html', '01-screens/01-home.html', '01-screens/components/part.html', 'components/old-board.html'
    ]);
    write('designs.json', JSON.stringify({ sections: [{ title: 'Screens', folder: '01-screens' }] }));
    assert.ok(!lines(loadDesignsManifest(dir)).some((line) => line.includes('?preview')));
  });

  test('"components": "show" adds every component, alone in its frame, after the designs', () => {
    write('designs.json', JSON.stringify({ components: 'show' }));
    const manifest = loadDesignsManifest(dir);
    // Without sections designs.json only sets things: the canvas is the files', with the folder's name
    assert.equal(manifest.title, path.basename(dir));
    assert.deepEqual(lines(manifest), [
      ' | Cover | cover.html | 1200x- | desktop',
      'screens | Home | 01-screens/01-home.html | 390x844 | mobile',
      'screens / components | part | 01-screens/components/part.html | 720x600 | components',
      'components | Old board | components/old-board.html | 720x600 | components',
      'components | <app-bar> | components/app-bar.html?preview | 1280x- | components',
      'components | <tx-item> | components/tx-item.html?preview | 480x- | components'
    ]);
    assert.deepEqual(manifest.sections.at(-1).artboards.slice(1).map((b) => b.id), ['components-app-bar', 'components-tx-item']);
  });

  test('designs.json can list components or bring the folder, like designs', () => {
    fs.rmSync(path.join(dir, 'components/old-board.html'));
    write('designs.json', JSON.stringify({
      unlisted: 'hide',
      sections: [{ title: 'Kit', designs: [{ file: 'components/tx-item.html', title: 'Row' }] }]
    }));
    assert.deepEqual(lines(loadDesignsManifest(dir)), ['Kit | Row | components/tx-item.html?preview | 480x- | components']);

    write('designs.json', JSON.stringify({ unlisted: 'hide', components: 'show', sections: [{ title: 'Start', designs: ['cover.html'] }] }));
    assert.deepEqual(lines(loadDesignsManifest(dir)), [
      'Start | Cover | cover.html | 1200x- | desktop',
      'components | <app-bar> | components/app-bar.html?preview | 1280x- | components',
      'components | <tx-item> | components/tx-item.html?preview | 480x- | components'
    ]);

    write('designs.json', JSON.stringify({ unlisted: 'hide', sections: [{ title: 'Kit', folder: 'components' }] }));
    assert.deepEqual(lines(loadDesignsManifest(dir)).map((line) => line.split(' | ')[1]), ['<app-bar>', '<tx-item>']);
  });

  test('with --root, a preview\'s path starts from the root', () => {
    const designs = path.join(dir, 'design');
    write('design/components/tx-item.html', '<b>{{name}}</b>');
    write('design/designs.json', JSON.stringify({ components: 'show' }));
    const [board] = loadDesignsManifest(designs, dir).sections.at(-1).artboards;
    assert.equal(board.file, 'design/components/tx-item.html?preview');
  });

  test('the server shows a component alone: its example, the stylesheets at the top, components.js', async () => {
    write('styles.css', ':root { --accent: red; }');
    write('b-theme.css', '');
    const server = await startServer({ dir, port: 3931 });
    try {
      const preview = await fetch(`${server.url}/components/tx-item.html?preview`);
      assert.equal(preview.status, 200);
      assert.match(preview.headers.get('content-type'), /text\/html/);
      const html = await preview.text();
      assert.match(html, /<title>&lt;tx-item&gt;<\/title>/);
      assert.match(html, /<link rel="stylesheet" href="\.\.\/b-theme\.css">\s*<link rel="stylesheet" href="\.\.\/styles\.css">\s*<script type="module" src="\.\.\/components\.js"><\/script>/);
      assert.match(html, /<body>\s*<tx-item name="Tea"><\/tx-item>\s*<\/body>/);
      // The file itself, for components.js to read
      assert.equal(await (await fetch(`${server.url}/components/tx-item.html`)).text(), fs.readFileSync(path.join(dir, 'components/tx-item.html'), 'utf8'));
      // ?preview on anything else is just the file
      assert.match(await (await fetch(`${server.url}/components/old-board.html?preview`)).text(), /<title>Old board<\/title>/);
      assert.match(await (await fetch(`${server.url}/cover.html?preview`)).text(), /<title>Cover<\/title>/);
    } finally {
      await server.close();
    }
  });
});

describe('htmlboard components', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-components-install-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('adds components.js and components/, locked beside them; adding it again is a no-op', () => {
    const designs = path.join(dir, 'designs');
    const script = path.join(designs, 'components.js');
    assert.equal(installComponents({ dir: designs }).status, 'installed');
    assert.ok(fs.readFileSync(script).equals(fs.readFileSync(COMPONENTS_SCRIPT_SOURCE)));
    assert.ok(fs.statSync(path.join(designs, 'components')).isDirectory());
    const lock = fs.readFileSync(path.join(designs, LOCK_FILE), 'utf8');
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex');
    assert.deepEqual(JSON.parse(lock), { htmlboard: VERSION, files: { 'components.js': sha256 } });

    assert.deepEqual(installComponents({ dir: designs }), { path: script, status: 'unchanged' });
    assert.equal(fs.readFileSync(path.join(designs, LOCK_FILE), 'utf8'), lock);
  });

  test('an upgrade updates a components.js nobody changed, with no --force', async () => {
    const designs = path.join(dir, 'designs');
    installComponents({ dir: designs });
    const next = await release(path.join(dir, 'next'), '999.0.0');

    assert.equal(next({ dir: designs }).status, 'updated');
    assert.match(fs.readFileSync(path.join(designs, 'components.js'), 'utf8'), /A line from another release/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(designs, LOCK_FILE), 'utf8')).htmlboard, '999.0.0');
  });

  test('a components.js changed locally is kept after an upgrade, and --force replaces it', async () => {
    const designs = path.join(dir, 'designs');
    const script = path.join(designs, 'components.js');
    installComponents({ dir: designs });
    fs.appendFileSync(script, '// mine\n');
    assert.deepEqual(installComponents({ dir: designs }), { path: script, status: 'skipped', reason: 'edited' });

    const next = await release(path.join(dir, 'next'), '999.0.0');
    assert.equal(next({ dir: designs }).reason, 'edited');
    assert.match(fs.readFileSync(script, 'utf8'), /\/\/ mine\n$/);
    assert.equal(next({ dir: designs, force: true }).status, 'updated');
    assert.doesNotMatch(fs.readFileSync(script, 'utf8'), /\/\/ mine/);
    assert.match(fs.readFileSync(script, 'utf8'), /A line from another release/);
  });

  test('a components.js the lock has no record of is kept; --force replaces it once', async () => {
    const designs = path.join(dir, 'designs');
    installComponents({ dir: designs });
    fs.rmSync(path.join(designs, LOCK_FILE)); // as htmlboard 0.10.0 and older left it
    const next = await release(path.join(dir, 'next'), '999.0.0');

    assert.equal(next({ dir: designs }).reason, 'unrecorded');
    assert.doesNotMatch(fs.readFileSync(path.join(designs, 'components.js'), 'utf8'), /A line from another release/);
    assert.equal(next({ dir: designs, force: true }).status, 'updated');

    const later = await release(path.join(dir, 'later'), '1000.0.0', '// A line from a later release.');
    assert.equal(later({ dir: designs }).status, 'updated');
    assert.match(fs.readFileSync(path.join(designs, 'components.js'), 'utf8'), /A line from a later release/);
  });

  test('an up-to-date components.js gets locked, and what else the lock lists stays', async () => {
    const designs = path.join(dir, 'designs');
    installComponents({ dir: designs });
    fs.writeFileSync(path.join(designs, LOCK_FILE), JSON.stringify({ htmlboard: '0.11.0', files: { 'other.js': 'abc' } }));

    assert.equal(installComponents({ dir: designs }).status, 'unchanged');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(designs, LOCK_FILE), 'utf8')).files), ['components.js', 'other.js']);
    const next = await release(path.join(dir, 'next'), '999.0.0');
    assert.equal(next({ dir: designs }).status, 'updated');
    assert.equal(JSON.parse(fs.readFileSync(path.join(designs, LOCK_FILE), 'utf8')).files['other.js'], 'abc');
  });

  test('a components.js a newer htmlboard added is kept, so an older one doesn\'t take it back', async () => {
    const designs = path.join(dir, 'designs');
    const next = await release(path.join(dir, 'next'), '999.0.0');
    next({ dir: designs });

    assert.equal(installComponents({ dir: designs }).reason, 'newer');
    assert.match(fs.readFileSync(path.join(designs, 'components.js'), 'utf8'), /A line from another release/);
    assert.equal(installComponents({ dir: designs, force: true }).status, 'updated');
  });

  test('--init locks the components.js it adds', async () => {
    const server = await startServer({ dir, port: 3991 });
    try {
      // With a canvas already running for the folder, the CLI adds the samples and exits
      const out = await new Promise((resolve, reject) => execFile(process.execPath, [CLI, dir, '--init', '-p', '3991'], { timeout: 10000 },
        (error, stdout) => (error ? reject(error) : resolve(stdout))));
      assert.match(out, /Recorded components\.js in \.htmlboard-lock\.json/);
      assert.ok(fs.existsSync(path.join(dir, LOCK_FILE)));
      assert.equal(installComponents({ dir }).status, 'unchanged');
    } finally {
      await server.close();
    }
  });

  test('CLI: htmlboard components <dir>', () => {
    const out = execFileSync(process.execPath, [CLI, 'components', 'designs'], { cwd: dir, encoding: 'utf8' });
    assert.match(out, /added/);
    assert.ok(fs.existsSync(path.join(dir, 'designs', 'components.js')));
    assert.match(execFileSync(process.execPath, [CLI, 'components', 'designs'], { cwd: dir, encoding: 'utf8' }), /up to date/);
  });

  test('CLI: says why it kept components.js', async () => {
    const run = (folder) => execFileSync(process.execPath, [CLI, 'components', folder], { cwd: dir, encoding: 'utf8' });
    for (const folder of ['edited', 'unrecorded']) {
      installComponents({ dir: path.join(dir, folder) });
      fs.appendFileSync(path.join(dir, folder, 'components.js'), '// mine\n');
    }
    fs.rmSync(path.join(dir, 'unrecorded', LOCK_FILE));
    (await release(path.join(dir, 'next'), '999.0.0'))({ dir: path.join(dir, 'newer') });

    assert.match(run('edited'), /changed locally, kept \(use --force to replace\)\S*  edited\/components\.js\n$/);
    const unrecorded = run('unrecorded');
    assert.match(unrecorded, /can't tell if it was changed locally, kept \(use --force to replace\)\S*  unrecorded\/components\.js\n/);
    assert.match(unrecorded, /added by htmlboard 0\.10\.0 or older has no record/);
    assert.match(run('newer'), /installed by a newer htmlboard, kept \(use --force to replace\)\S*  newer\/components\.js\n$/);
  });
});
