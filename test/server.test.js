import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, discoverDesigns, loadDesignsManifest } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, '..', 'src', 'templates');

describe('HtmlBoard Core Functionality', () => {
  let serverInstance = null;

  before(async () => {
    // Start server on a dynamic or free port pointing to templates dir
    serverInstance = await startServer({
      dir: TEMPLATES_DIR,
      port: 3912
    });
  });

  after(async () => {
    if (serverInstance) {
      await serverInstance.close();
    }
  });

  test('discoverDesigns returns structured sections and artboards', () => {
    const manifest = discoverDesigns(TEMPLATES_DIR);
    assert.ok(manifest);
    assert.equal(typeof manifest.title, 'string');
    assert.ok(Array.isArray(manifest.sections));
    assert.ok(manifest.sections.length > 0);

    const allArtboards = manifest.sections.flatMap((s) => s.artboards);
    assert.ok(allArtboards.some((b) => b.file.includes('mobile.html')));
    assert.ok(allArtboards.some((b) => b.file.includes('desktop.html')));
  });

  test('loadDesignsManifest loads explicit designs.json when present', () => {
    const manifest = loadDesignsManifest(TEMPLATES_DIR);
    assert.ok(manifest);
    assert.equal(manifest.autoDiscovered, false);
    assert.equal(manifest.title, 'Design Exploration Canvas');
    assert.ok(manifest.sections.length >= 2);
  });

  test('GET / serves the explorer index.html', async () => {
    const res = await fetch(`${serverInstance.url}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<title>htmlboard'));
    assert.ok(html.includes('/__explorer/favicon.svg'));
    assert.ok(html.includes('id="viewport"'));
  });

  test('GET /api/designs returns the designs manifest JSON', async () => {
    const res = await fetch(`${serverInstance.url}/api/designs`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.title);
    assert.ok(Array.isArray(data.sections));
  });

  test('GET /api/health returns health check status', async () => {
    const res = await fetch(`${serverInstance.url}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.match(data.version, /^\d+\.\d+\.\d+/);
  });

  test('GET /__explorer serves the logo files', async () => {
    for (const file of ['favicon.svg', 'logo.svg', 'mark.svg']) {
      const res = await fetch(`${serverInstance.url}/__explorer/${file}`);
      assert.equal(res.status, 200, file);
      assert.equal(res.headers.get('content-type'), 'image/svg+xml', file);
      assert.match(await res.text(), /<svg [^>]*aria-label="htmlboard"/, file);
    }
  });

  test('GET /artboards/mobile.html serves the sample mobile artboard', async () => {
    const res = await fetch(`${serverInstance.url}/artboards/mobile.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Mobile Feed Screen'));
    assert.ok(html.includes('$42,850.75'));
  });

  test('GET /__explorer/explorer.css serves the explorer CSS styles', async () => {
    const res = await fetch(`${serverInstance.url}/__explorer/explorer.css`);
    assert.equal(res.status, 200);
    const css = await res.text();
    assert.ok(css.includes('HtmlBoard explorer'));
  });

  test('GET /__explorer/fonts/inter.woff2 serves the bundled font', async () => {
    const res = await fetch(`${serverInstance.url}/__explorer/fonts/inter.woff2`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'font/woff2');
  });
});
