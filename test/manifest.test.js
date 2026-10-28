import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, normalizeManifest, loadDesignsManifest, discoverDesigns, inferCategory } from '../src/index.js';

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

  test('discovered artboards get the same slug ids as manifest ones', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-ids-'));
    fs.mkdirSync(path.join(dir, 'Checkout'));
    fs.writeFileSync(path.join(dir, 'Checkout', 'Variant B.html'), '<title>B</title>');
    const ids = discoverDesigns(dir).sections.flatMap((s) => s.artboards.map((b) => b.id));
    fs.rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(ids, ['checkout-variant-b']);
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

  // Listens to /api/events; next(until) reads until the text so far passes until (3 s at most).
  async function listen() {
    const controller = new AbortController();
    const res = await fetch(`${instance.url}/api/events`, { signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events = { text: '', close: () => controller.abort() };
    events.next = async (until) => {
      const deadline = Date.now() + 3000;
      while (!until(events.text) && Date.now() < deadline) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise((resolve) => setTimeout(() => resolve({ value: undefined, done: false }), 200))
        ]);
        if (done) break;
        if (value) events.text += decoder.decode(value, { stream: true });
      }
      return until(events.text);
    };
    await events.next((t) => t.includes('event: connected'));
    return events;
  }

  test('live reload reports every file saved in the same burst', async () => {
    const events = await listen();
    fs.writeFileSync(path.join(root, 'css', 'theme.css'), 'body { color: blue; }');
    fs.writeFileSync(path.join(root, 'design', 'home.html'), '<link rel="stylesheet" href="../css/theme.css"><main>Home 2</main>');
    await events.next((t) => t.includes('"css/theme.css"') && t.includes('"design/home.html"'));
    events.close();

    assert.match(events.text, /"type":"file","file":"css\/theme.css","isHtml":false/);
    assert.match(events.text, /"type":"file","file":"design\/home.html","isHtml":true/);
  });

  test('live reload keeps following a file saved by replacing it', async () => {
    const page = path.join(root, 'design', 'home.html');
    const events = await listen();
    // Saved the way many editors do: a copy written next to it, renamed over it
    fs.writeFileSync(`${page}.new`, '<main>Home 3</main>');
    fs.renameSync(`${page}.new`, page);
    assert.ok(await events.next((t) => t.includes('"design/home.html"')), 'the replacing save is reported');
    await new Promise((resolve) => setTimeout(resolve, 300));
    events.text = '';
    fs.appendFileSync(page, '<p>edited in place</p>');
    assert.ok(await events.next((t) => t.includes('"design/home.html"')), 'a later save to the new file is reported too');
    events.close();
  });

  test('live reload reports folders added and removed', async () => {
    const events = await listen();
    fs.mkdirSync(path.join(root, 'design', 'drafts'));
    fs.writeFileSync(path.join(root, 'design', 'drafts', 'a.html'), '<main>A</main>');
    assert.ok(await events.next((t) => t.includes('"type":"folder","file":"design/drafts"')));
    await new Promise((resolve) => setTimeout(resolve, 300));
    events.text = '';
    fs.writeFileSync(path.join(root, 'design', 'drafts', 'b.html'), '<main>B</main>');
    assert.ok(await events.next((t) => t.includes('"design/drafts/b.html"')), 'files in a new folder are watched');
    await new Promise((resolve) => setTimeout(resolve, 300));
    events.text = '';
    fs.rmSync(path.join(root, 'design', 'drafts'), { recursive: true });
    assert.ok(await events.next((t) => t.includes('"type":"folder","file":"design/drafts"')), 'a removed folder is reported');
    events.close();
  });

  test('the designs folder must be inside the root', async () => {
    await assert.rejects(startServer({ dir: os.tmpdir(), root, port: 3941 }), /must be inside the root/);
  });
});
