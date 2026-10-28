import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDesignMeta, loadDesignsManifest } from '../src/index.js';
import { planMigration, checkMigration, applyMigration } from '../src/migrate.js';

const page = (head = '', title = 'Page') => `<!doctype html>\n<html>\n<head>\n  <title>${title}</title>\n${head}</head>\n<body><main>x</main></body>\n</html>\n`;

// The canvas as "section | title | file | width x height | category" lines
const lines = (manifest) => manifest.sections.flatMap((s) => s.artboards.map((b) =>
  `${s.name} | ${b.title} | ${b.file} | ${b.width}x${b.height ?? '-'} | ${b.category ?? '-'}`));

describe('What a file says about itself', () => {
  test('title, description and htmlboard tags', () => {
    const meta = parseDesignMeta(`<html><head>
      <title>Caf&eacute; &amp; Bar · Início</title>
      <meta content="The menu" name='description'>
      <meta name="htmlboard" content="width=390, height=844; category=Mobile">
      <meta name="htmlboard:label" content="claro">
      <meta name="htmlboard:variant" content="?tema=escuro · escuro">
      <meta name="htmlboard:variant" content="mode=empty">
    </head><body><meta name="htmlboard" content="skip"></body></html>`);
    assert.equal(meta.title, 'Caf&eacute; & Bar · Início'); // unknown entities stay as written
    assert.equal(meta.description, 'The menu');
    assert.deepEqual([meta.width, meta.height, meta.category, meta.label], [390, 844, 'mobile', 'claro']);
    assert.deepEqual(meta.variants, [{ query: '?tema=escuro', label: 'escuro' }, { query: '?mode=empty', label: '' }]);
    assert.equal(meta.skip, undefined, 'only the <head> counts');
  });

  test('skip, and values it ignores', () => {
    assert.equal(parseDesignMeta('<head><meta name="htmlboard" content="skip"></head>').skip, true);
    const meta = parseDesignMeta('<head><meta name="htmlboard" content="width=wide, height=-3, colour=red"></head>');
    assert.deepEqual([meta.width, meta.height], [undefined, undefined]);
  });
});

describe('Designs from folders and files', () => {
  let dir;
  const write = (file, html) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), html);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-designs-'));
    write('cover.html', page('', 'Cover'));
    write('10-flyers/2-poster.html', page('  <meta name="htmlboard" content="width=1080, height=1350">\n  <meta name="htmlboard:variant" content="?sky=night · night">\n', 'Poster'));
    write('10-flyers/10-notice.html', page('  <meta name="htmlboard" content="width=1080, height=1350">\n', 'Notice'));
    write('2-screens/01-home.html', page('  <meta name="htmlboard" content="width=390, height=844">\n  <meta name="htmlboard:label" content="light">\n  <meta name="htmlboard:variant" content="?theme=dark · dark">\n', 'Home'));
    write('2-screens/02-about.html', page('  <meta name="htmlboard" content="width=1440">\n', 'About'));
    write('2-screens/partial.html', page('  <meta name="htmlboard" content="skip">\n'));
    write('2-screens/node_modules/x.html', page());
    write('.drafts/y.html', page());
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('without designs.json: folders are sections, prefixes the order, files their own facts', () => {
    const manifest = loadDesignsManifest(dir);
    assert.equal(manifest.autoDiscovered, true);
    assert.deepEqual(lines(manifest), [
      ' | Cover | cover.html | 1200x- | desktop',
      'screens | Home · light | 2-screens/01-home.html | 390x844 | mobile',
      'screens | Home · dark | 2-screens/01-home.html?theme=dark | 390x844 | mobile',
      'screens | About | 2-screens/02-about.html | 1440x- | desktop',
      'flyers | Poster | 10-flyers/2-poster.html | 1080x1350 | -',
      'flyers | Poster · night | 10-flyers/2-poster.html?sky=night | 1080x1350 | -',
      'flyers | Notice | 10-flyers/10-notice.html | 1080x1350 | -'
    ]);
    // Ids leave the prefixes out, so reordering doesn't break links
    assert.deepEqual(manifest.sections[1].artboards.map((b) => b.id), ['screens-home', 'screens-home-theme-dark', 'screens-about']);
  });

  test('designs.json curates: its sections first, its values on top, the rest after', () => {
    write('designs.json', JSON.stringify({
      title: 'Brand',
      sections: [
        { title: 'Posters', designs: ['10-flyers/2-poster.html', { file: 'cover.html', title: 'The cover', height: 600 }] },
        { title: 'Screens', designs: ['2-screens/01-home.html?theme=dark', '2-screens/01-home.html'] }
      ]
    }));
    const manifest = loadDesignsManifest(dir);
    assert.equal(manifest.autoDiscovered, false);
    assert.deepEqual(lines(manifest), [
      'Posters | Poster | 10-flyers/2-poster.html | 1080x1350 | -',
      'Posters | Poster · night | 10-flyers/2-poster.html?sky=night | 1080x1350 | -',
      'Posters | The cover | cover.html | 1200x600 | desktop',
      // Placed by designs.json, the variant doesn't follow its file; the folder's new file joins the section
      'Screens | Home · dark | 2-screens/01-home.html?theme=dark | 390x844 | mobile',
      'Screens | Home · light | 2-screens/01-home.html | 390x844 | mobile',
      'Screens | About | 2-screens/02-about.html | 1440x- | desktop',
      'flyers | Notice | 10-flyers/10-notice.html | 1080x1350 | -'
    ]);
  });

  test('"unlisted": "hide" shows only what designs.json lists; "folder" brings a whole folder', () => {
    write('designs.json', JSON.stringify({ unlisted: 'hide', sections: [{ title: 'Flyers', folder: '10-flyers' }, { title: 'Start', designs: ['cover.html'] }] }));
    assert.deepEqual(lines(loadDesignsManifest(dir)), [
      'Flyers | Poster | 10-flyers/2-poster.html | 1080x1350 | -',
      'Flyers | Poster · night | 10-flyers/2-poster.html?sky=night | 1080x1350 | -',
      'Flyers | Notice | 10-flyers/10-notice.html | 1080x1350 | -',
      'Start | Cover | cover.html | 1200x- | desktop'
    ]);
  });

  test('designs it doesn\'t list at the top go to an Unlisted section', () => {
    write('designs.json', JSON.stringify({ sections: [{ title: 'Flyers', folder: '10-flyers' }, { title: 'Screens', folder: '2-screens' }] }));
    assert.deepEqual(lines(loadDesignsManifest(dir)).at(-1), 'Unlisted | Cover | cover.html | 1200x- | desktop');
  });

  test('a broken designs.json falls back to the files', () => {
    write('designs.json', '{ nope');
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(loadDesignsManifest(dir).autoDiscovered, true);
    } finally {
      console.warn = warn;
    }
  });
});

describe('htmlboard migrate', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-migrate-test-'));
    fs.writeFileSync(path.join(dir, 'home.html'), page('', 'Home'));
    fs.writeFileSync(path.join(dir, 'flyer.html'), page('  <meta name="description" content="A flyer">\n', 'Flyer'));
    fs.writeFileSync(path.join(dir, 'board.html'), page('', 'Board'));
    fs.writeFileSync(path.join(dir, 'designs.json'), JSON.stringify({
      title: 'Old',
      sections: [
        {
          title: 'Screens',
          designs: [
            { file: 'home.html', title: 'Home · light', width: 390, height: 844 },
            { file: 'home.html?theme=dark', title: 'Home · dark', width: 390, height: 844 }
          ]
        },
        {
          title: 'Print',
          designs: [
            { file: 'flyer.html', title: 'Flyer · day', width: 1080, height: 1350 },
            { file: 'flyer.html?sky=night', title: 'Flyer · night', width: 1080, height: 1350 },
            { file: 'board.html', title: 'The big board', width: 1200 }
          ]
        }
      ]
    }, null, 2));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('moves sizes, labels and variants into the files and keeps the canvas', () => {
    const before = lines(loadDesignsManifest(dir));
    const plan = planMigration(dir);
    assert.deepEqual(checkMigration(dir, plan), []);
    assert.deepEqual(plan.entries, [5, 3]);
    assert.deepEqual(plan.config.sections.map((s) => s.designs), [
      ['home.html'],
      ['flyer.html', { file: 'board.html', title: 'The big board' }]
    ]);
    applyMigration(dir, plan);
    assert.deepEqual(lines(loadDesignsManifest(dir)), before);
    const home = fs.readFileSync(path.join(dir, 'home.html'), 'utf8');
    assert.match(home, /  <title>Home<\/title>\n  <meta name="htmlboard" content="width=390, height=844">\n  <meta name="htmlboard:label" content="light">\n  <meta name="htmlboard:variant" content="\?theme=dark · dark">\n/);
    // Running it again changes nothing
    const again = planMigration(dir);
    assert.equal(again.files.length, 0);
    assert.deepEqual(again.entries, [3, 3]);
  });
});
