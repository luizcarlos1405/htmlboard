import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, normalizeManifest, loadDesignsManifest, inferCategory } from '../src/index.js';

describe('Manifest short form and --root', () => {
  let root;
  let instance;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-root-'));
    fs.mkdirSync(path.join(root, 'css'));
    fs.mkdirSync(path.join(root, 'design'));
    fs.writeFileSync(path.join(root, 'css', 'theme.css'), 'body { color: red; }');
    fs.writeFileSync(path.join(root, 'design', 'home.html'), '<link rel="stylesheet" href="../css/theme.css"><main>Home</main>');
    fs.writeFileSync(path.join(root, 'design', 'designs.json'), JSON.stringify({
      sections: [{
        title: 'Início',
        designs: [
          { file: 'home.html', title: 'Home · light', width: 390, height: 844 },
          { file: 'home.html?tema=escuro', title: 'Home · dark', width: 390, height: 844 }
        ]
      }]
    }));
    instance = await startServer({ dir: path.join(root, 'design'), root, port: 3940 });
  });

  after(async () => {
    await instance?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('normalizeManifest accepts sections[].title and designs[]', () => {
    const { sections } = normalizeManifest({
      sections: [{ title: 'Céu · Terra', designs: [{ file: 'a.html', width: 1440 }, { file: 'a.html' }] }]
    });
    assert.equal(sections[0].name, 'Céu · Terra');
    assert.equal(sections[0].id, 'ceu-terra');
    assert.deepEqual(sections[0].artboards.map((b) => b.id), ['a', 'a-2']);
    assert.equal(sections[0].artboards[0].title, 'a.html');
    assert.equal(sections[0].artboards[0].category, 'desktop');
  });

  test('inferCategory reads path words, then width', () => {
    assert.equal(inferCategory('checkout/mobile-b.html'), 'mobile');
    assert.equal(inferCategory('guide.html'), 'responsive');
    assert.equal(inferCategory('ui/buttons.html'), 'components');
    assert.equal(inferCategory('flyer.html', 1080), 'desktop');
    assert.equal(inferCategory('card.html', 390), 'mobile');
  });

  test('files are given relative to the root', () => {
    const manifest = loadDesignsManifest(path.join(root, 'design'), root);
    assert.deepEqual(manifest.sections[0].artboards.map((b) => b.file), ['design/home.html', 'design/home.html?tema=escuro']);
  });

  test('the server serves shared files above the designs folder', async () => {
    const css = await fetch(`${instance.url}/css/theme.css`);
    assert.equal(css.status, 200);
    const designs = await (await fetch(`${instance.url}/api/designs`)).json();
    assert.equal(designs.sections[0].artboards[1].file, 'design/home.html?tema=escuro');
  });

  test('the server refuses files outside the root', async () => {
    const res = await fetch(`${instance.url}/..%2F..%2Fetc%2Fpasswd`);
    assert.notEqual(res.status, 200);
  });

  test('the designs folder must be inside the root', async () => {
    await assert.rejects(startServer({ dir: os.tmpdir(), root, port: 3941 }), /must be inside the root/);
  });
});
