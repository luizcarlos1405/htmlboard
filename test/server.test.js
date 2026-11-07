import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
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
    assert.ok(allArtboards.some((b) => b.file.includes('dashboard.html')));
  });

  test('the sample designs describe themselves: folders, sizes, descriptions', () => {
    const manifest = loadDesignsManifest(TEMPLATES_DIR);
    assert.equal(manifest.autoDiscovered, true);
    // components/ holds components, not designs
    assert.deepEqual(manifest.sections.map((s) => s.name), ['screens', 'ui kit']);
    const [dashboard, customers, mobile] = manifest.sections[0].artboards;
    assert.equal(dashboard.title, 'Dashboard');
    assert.equal(dashboard.id, 'screens-dashboard');
    assert.deepEqual([dashboard.width, dashboard.height, dashboard.category], [1280, 820, 'desktop']);
    assert.deepEqual([customers.width, customers.height, customers.category], [1280, 820, 'desktop']);
    assert.deepEqual([mobile.width, mobile.height, mobile.category], [390, 844, 'mobile']);
    assert.match(mobile.description, /balance card/);
    const [kit] = manifest.sections[1].artboards;
    assert.deepEqual([kit.width, kit.height, kit.category], [780, undefined, 'components']);
  });

  test('GET / serves the explorer index.html', async () => {
    const res = await fetch(`${serverInstance.url}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<title>htmlboard'));
    assert.ok(html.includes('/__explorer/favicon.svg'));
    assert.ok(html.includes('id="viewport"'));
  });

  test('GET /index.html falls back to the explorer without a root index', async () => {
    const res = await fetch(`${serverInstance.url}/index.html`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('id="viewport"'));
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

  test('GET /01-screens/03-mobile.html serves the sample mobile artboard', async () => {
    const res = await fetch(`${serverInstance.url}/01-screens/03-mobile.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Mobile Feed Screen'));
    assert.ok(html.includes('$42,850.75'));
  });

  test('the sample designs share styles.css and components', async () => {
    const res = await fetch(`${serverInstance.url}/styles.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/css/);
    assert.ok((await res.text()).includes('--accent'));
    const designs = ['01-screens/01-dashboard.html', '01-screens/02-customers.html', '01-screens/03-mobile.html', '02-ui-kit/01-overview.html']
      .map((file) => [file, fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8')]);
    for (const [file, html] of designs) {
      assert.ok(html.includes('<link rel="stylesheet" href="../styles.css">'), file);
      assert.ok(html.includes('<script type="module" src="../components.js"></script>'), file);
    }
    // Every sample component starts with an example and is used by two designs
    const components = fs.readdirSync(path.join(TEMPLATES_DIR, 'components'));
    assert.deepEqual(components.sort(), ['app-sidebar.html', 'app-topbar.html', 'stat-card.html', 'tx-item.html']);
    for (const file of components) {
      const tag = file.replace('.html', '');
      assert.match(fs.readFileSync(path.join(TEMPLATES_DIR, 'components', file), 'utf8'), new RegExp(`^<!-- <${tag}[ >]`), file);
      assert.equal(designs.filter(([, html]) => html.includes(`<${tag} `)).length, 2, tag);
    }
    const loader = await fetch(`${serverInstance.url}/components.js`);
    assert.match(loader.headers.get('content-type'), /javascript/);
    assert.match(await loader.text(), /customElements\.define/);
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


test('GET /index.html serves the root page and injects the probe only for frames', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-index-'));
  const dir = path.join(root, 'design');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>My page</title><p>Project page</p>');
  const instance = await startServer({ dir, root, port: 3913 });
  t.after(async () => {
    await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const res = await fetch(`${instance.url}/index.html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('<title>My page</title>'));
  assert.ok(!html.includes('/__explorer/probe.js'));

  const framed = await fetch(`${instance.url}/index.html`, {
    headers: { 'Sec-Fetch-Dest': 'iframe' }
  });
  const framedHtml = await framed.text();
  assert.ok(framedHtml.includes('<title>My page</title>'));
  assert.ok(framedHtml.includes('/__explorer/probe.js'));

  const explorer = await fetch(`${instance.url}/`);
  assert.ok((await explorer.text()).includes('id="viewport"'));
});
