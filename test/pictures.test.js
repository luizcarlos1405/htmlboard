import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../src/index.js';
import { openPictures, pictureQueue, pictureKey, designKey, CACHE_FOLDER } from '../src/pictures.js';

// A PNG of 1 × 1 px, as a browser would make one
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');

const page = (title) => `<!DOCTYPE html>\n<html>\n<head>\n<title>${title}</title>\n<meta name="htmlboard" content="width=390, height=844">\n<link rel="stylesheet" href="styles.css">\n</head>\n<body><p>${title}</p></body>\n</html>\n`;

const until = async (check, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 25))) if (check()) return true;
  return check();
};

/** An executable file in dir (a stand-in for a browser) */
function executable(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
  return file;
}

// What a page out of sight does once it's open: hears the server's events (the server waits for
// that), then asks for designs to picture and makes them, as client/maker.js does
const MAKER = `
const page = new URL(process.argv.at(-1));
const at = (p) => new URL(p, page);
http.get(at('/api/events'), (res) => res.resume().on('end', () => process.exit(0))).on('error', () => process.exit(0));
async function make(url, picture) {
  const maker = url.searchParams.get('maker');
  for (;;) {
    let res;
    try {
      res = await fetch(at('/api/pictures/next?maker=' + maker), { method: 'POST' });
    } catch {
      return;
    }
    if (res.status !== 200) continue;
    const job = await res.json();
    const report = { job: job.id, width: Number(job.design.width) || 1200, height: Number(job.design.height) || 700, files: [at('/' + job.design.file).href, at('/styles.css').href], themes: ['dark'] };
    await picture(maker, job, report);
  }
}
`;

// Firefox out of sight: its page draws each picture itself and sends it
const FAKE_FIREFOX = `#!/usr/bin/env node
import http from 'node:http';
${MAKER}
make(page, (maker, job, report) => fetch(at('/api/pictures'), { method: 'POST', body: JSON.stringify({ ...report, type: 'image/png', image: '${PNG_BASE64}' }) }));
`;

// Chromium out of sight: its DevTools pipe (fd 3 in, fd 4 out, messages ending in NUL) answers what
// the server asks, each call noted in FAKE_CDP_LOG; its tabs ask the server to shoot their design
const FAKE_CHROMIUM = `#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
${MAKER}
const shoot = (maker, job, report) => fetch(at('/api/pictures?shoot&maker=' + maker), { method: 'POST', body: JSON.stringify(report) });
const out = fs.createWriteStream(null, { fd: 4 });
const targets = [{ targetId: 't0', type: 'page', url: page.href }];
let buffer = '';
fs.createReadStream(null, { fd: 3 }).on('data', (chunk) => {
  buffer += chunk;
  for (let end = buffer.indexOf('\\0'); end >= 0; end = buffer.indexOf('\\0')) {
    const { id, method, params, sessionId } = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (process.env.FAKE_CDP_LOG) fs.appendFileSync(process.env.FAKE_CDP_LOG, JSON.stringify({ method, params, sessionId }) + '\\n');
    let result = {};
    if (method === 'Target.getTargets') result = { targetInfos: targets };
    else if (method === 'Target.createTarget') {
      targets.push({ targetId: 't' + targets.length, type: 'page', url: params.url });
      result = { targetId: targets.at(-1).targetId };
      make(new URL(params.url), shoot);
    } else if (method === 'Target.attachToTarget') result = { sessionId: 'session-' + params.targetId };
    else if (method === 'Page.captureScreenshot') result = { data: '${PNG_BASE64}' };
    out.write(JSON.stringify({ id, result }) + '\\0');
  }
}).on('end', () => process.exit(0));
make(page, shoot);
`;

/** The server's events, as a canvas hears them: picture, pictures and change, each as it came */
function listen(url) {
  const events = { picture: [], pictures: [], change: [] };
  const req = http.get(`${url}/api/events`, (res) => {
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = block.match(/^event: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (event in events) events[event].push(JSON.parse(data));
      }
    });
  });
  req.on('error', () => {});
  return Object.assign(events, { stop: () => req.destroy() });
}

const getJson = async (url, init) => (await fetch(url, init)).json();
const keysOf = async (url) => (await getJson(`${url}/api/designs`)).sections.flatMap((section) => section.artboards).map(designKey);
const post = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('Pictures kept in the designs folder', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-pictures-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const key = pictureKey({ file: 'home.html', width: 390, height: 844 }, { scale: 0.25 });

  test('nothing is written until a picture is; then a folder git ignores by itself, kept between servers', () => {
    const store = openPictures(dir, dir);
    assert.equal(store.find([key]).size, 0);
    assert.ok(!fs.existsSync(path.join(dir, CACHE_FOLDER)));
    fs.writeFileSync(path.join(dir, 'home.html'), page('Home'));
    fs.writeFileSync(path.join(dir, 'styles.css'), 'p { color: red; }');
    const kept = store.put(key, { height: 844, themes: ['dark'], files: ['home.html', 'styles.css'], since: Date.now() + 1000 }, PNG, 'image/png');
    assert.deepEqual({ ...kept, image: undefined }, { image: undefined, height: 844, themes: ['dark'], fresh: true });
    assert.match(kept.image, /^[0-9a-f]{16}-[0-9a-z]+\.png$/);
    assert.ok(fs.existsSync(store.imageFile(kept.image)));
    const ignore = fs.readFileSync(path.join(dir, CACHE_FOLDER, '.gitignore'), 'utf8');
    assert.deepEqual(ignore.split('\n').filter((line) => line && !line.startsWith('#')), ['*']);
    store.flush();
    assert.equal(openPictures(dir, dir).find([key]).get(key).fresh, true, 'a server started again has it');
    assert.equal(store.imageFile('../../etc/passwd'), null);
  });

  test('out of date once a file its page used changes, comes or goes; made again, the old image goes', () => {
    const store = openPictures(dir, dir);
    fs.writeFileSync(path.join(dir, 'styles.css'), 'p { color: blue; }');
    assert.equal(store.find([key]).get(key).fresh, false, 'a file it used changed');
    const first = store.put(key, { height: 844, files: ['home.html', 'styles.css', 'gone.css'], since: Date.now() + 1000 }, PNG, 'image/png');
    assert.equal(first.fresh, true, 'a file it asked for that is not there is part of it');
    fs.writeFileSync(path.join(dir, 'gone.css'), 'p { margin: 0; }');
    assert.equal(store.find([key]).get(key).fresh, false, 'the file it asked for came');
    const second = store.put(key, { height: 844, files: ['home.html', 'styles.css', 'gone.css'], since: Date.now() + 1000 }, PNG, 'image/png');
    assert.ok(!fs.existsSync(store.imageFile(first.image)), 'one image per picture');
    fs.rmSync(path.join(dir, 'gone.css'));
    assert.equal(store.find([key]).get(key).fresh, false, 'a file it used is gone');
    assert.ok(fs.existsSync(store.imageFile(second.image)), 'shown until made again');
  });

  test('a file that changed while it was made makes it out of date at once', () => {
    const store = openPictures(dir, dir);
    const since = Date.now() - 60000; // its page started loading before styles.css was last saved
    fs.writeFileSync(path.join(dir, 'styles.css'), 'p { color: green; }');
    assert.equal(store.put(key, { height: 844, files: ['home.html', 'styles.css'], since }, PNG, 'image/png').fresh, false);
  });

  test('the pictures of designs no longer on the canvas go once they are a week old', () => {
    const store = openPictures(dir, dir);
    const other = pictureKey({ file: 'about.html', width: 390, height: 844 }, { scale: 0.25 });
    const { image } = store.put(other, { height: 844, files: [], since: Date.now() + 1000 }, PNG, 'image/png');
    store.put(key, { height: 844, files: [], since: Date.now() + 1000 }, PNG, 'image/png');
    const home = (design) => design === designKey({ file: 'home.html', width: 390, height: 844 });
    store.prune(home);
    assert.deepEqual([...store.find([key, other]).keys()], [key, other], 'back on the canvas within a week: still there');
    store.prune(home, Date.now() + 8 * 24 * 60 * 60 * 1000);
    assert.deepEqual([...store.find([key, other]).keys()], [key]);
    assert.ok(!fs.existsSync(store.imageFile(image)));
  });
});

describe('The pictures to make', () => {
  const job = (n) => ({ key: `k${n}`, design: { file: `${n}.html` } });

  test('first first, a newer ask before the ones waiting, each picture once', async () => {
    const queue = pictureQueue();
    assert.equal(queue.want([job(1), job(2)]), 2);
    assert.equal(queue.want([job(3), job(2)]), 1, '2 again: moved up, not counted again');
    const order = [];
    for (let i = 0; i < 3; i++) order.push((await queue.next(10)).key);
    assert.deepEqual(order, ['k3', 'k2', 'k1']);
    assert.equal(queue.want([job(1)]), 0, 'being made');
    assert.equal(await queue.next(10), null);
  });

  test('a maker waiting gets the next one as soon as it comes; one that gives up waits no more', async () => {
    const queue = pictureQueue();
    const waiting = queue.next(5000);
    queue.want([job(1)]);
    assert.equal((await waiting).key, 'k1');
    const stop = new AbortController();
    const gone = queue.next(5000, stop.signal);
    stop.abort();
    assert.equal(await gone, null);
    queue.want([job(2)]);
    assert.equal((await queue.next(10)).key, 'k2', 'not handed to the maker that went');
  });

  test('one that fails is tried once more, then given up on until files change', async () => {
    const queue = pictureQueue();
    queue.want([job(1)]);
    assert.equal(queue.done((await queue.next(10)).id, false).gaveUp, undefined);
    const again = await queue.next(10);
    assert.equal(again.key, 'k1');
    assert.equal(queue.done(again.id, false).gaveUp, true);
    assert.equal(queue.want([job(1)]), 0, 'given up on');
    queue.forgetFailures();
    assert.equal(queue.want([job(1)]), 1);
  });

  test('a browser that quits with pictures in hand: each counts as a try that failed', async () => {
    const queue = pictureQueue();
    queue.want([job(1)]);
    await queue.next(10);
    queue.stopAll();
    const again = await queue.next(10);
    assert.equal(again.key, 'k1');
    queue.stopAll();
    assert.equal(await queue.next(10), null, 'twice: given up on');
    assert.ok(queue.idle());
  });

  test('made while one of its files changed: made again, a few times at most', async () => {
    const queue = pictureQueue();
    queue.want([job(1)]);
    let made = 0;
    for (let job = await queue.next(10); job; job = await queue.next(10)) {
      made++;
      queue.done(job.id, true, { fresh: false });
    }
    assert.equal(made, 4, 'once, and again 3 times');
  });

  test('how far they have got, until they are all made', async () => {
    const seen = [];
    const queue = pictureQueue({ onChange: (progress) => seen.push(progress) });
    queue.want([job(1), job(2)]);
    queue.done((await queue.next(10)).id, true);
    queue.done((await queue.next(10)).id, true);
    assert.deepEqual(seen.at(0), { done: 0, total: 2 });
    assert.deepEqual(seen.at(-1), { done: 2, total: 2 });
    assert.deepEqual(queue.progress(), { done: 0, total: 0 }, 'counted afresh after');
  });
});

describe('Pictures made out of sight', () => {
  let dir;
  let fakes;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-pictures-'));
    fakes = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-fakes-'));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fakes, { recursive: true, force: true });
  });

  const project = () => {
    fs.rmSync(path.join(dir, CACHE_FOLDER), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, 'home.html'), page('Home'));
    fs.writeFileSync(path.join(dir, 'about.html'), page('About'));
    fs.writeFileSync(path.join(dir, 'styles.css'), 'p { color: red; }');
  };

  test('Chromium: its tabs shoot each design at the scale asked, kept and told to the canvases', async () => {
    project();
    const log = path.join(fakes, 'cdp.log');
    fs.rmSync(log, { force: true });
    process.env.FAKE_CDP_LOG = log;
    const browser = { path: executable(fakes, 'chromium', FAKE_CHROMIUM), name: 'Fake Chromium', engine: 'chromium' };
    const server = await startServer({ dir, port: 0, host: '127.0.0.1', quiet: true, browser, headlessIdleMs: 300 });
    const events = listen(server.url);
    try {
      const listed = await getJson(`${server.url}/api/pictures?scale=0.5&scheme=dark`);
      assert.deepEqual(listed, { maker: { name: 'Fake Chromium', engine: 'chromium' }, pictures: {}, progress: { done: 0, total: 0 } });
      const designs = await keysOf(server.url);
      assert.deepEqual(await post(`${server.url}/api/pictures/wanted`, { scale: 0.5, scheme: 'dark', designs }), { maker: true, queued: 2 });
      assert.ok(await until(() => events.picture.length === 2), 'both made');
      assert.ok(await until(() => events.pictures.at(-1)?.done === 2 && events.pictures.at(-1)?.total === 2), 'and the canvases told how far they got');
      assert.deepEqual(events.picture.map((picture) => [picture.design, picture.scheme, picture.scale, picture.fresh]).sort(),
        designs.map((design) => [design, 'dark', 0.5, true]).sort());
      const kept = await getJson(`${server.url}/api/pictures?scale=0.5&scheme=dark`);
      assert.deepEqual(Object.keys(kept.pictures).sort(), [...designs].sort());
      const image = await fetch(server.url + kept.pictures[designs[0]].url);
      assert.equal(image.headers.get('content-type'), 'image/webp');
      assert.match(image.headers.get('cache-control'), /immutable/);
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      const shots = calls.filter((call) => call.method === 'Page.captureScreenshot');
      assert.equal(shots.length, 2);
      assert.deepEqual(shots[0].params.clip, { x: 0, y: 0, width: 390, height: 844, scale: 0.5 });
      assert.equal(shots[0].params.format, 'webp');
      const sized = calls.find((call) => call.method === 'Emulation.setDeviceMetricsOverride');
      assert.deepEqual(sized.params, { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      for (const tab of calls.filter((call) => call.method === 'Target.createTarget')) {
        assert.match(tab.params.url, /\/\?worker&maker=\d+&engine=chromium&only=pictures$/);
        assert.equal(tab.params.newWindow, true);
      }
      // Pictures made already aren't made again; a save makes the ones of the designs that used the file out of date
      assert.deepEqual(await post(`${server.url}/api/pictures/wanted`, { scale: 0.5, scheme: 'dark', designs }), { maker: true, queued: 0 });
      fs.writeFileSync(path.join(dir, 'home.html'), page('Home, again'));
      const after = await getJson(`${server.url}/api/pictures?scale=0.5&scheme=dark`);
      assert.deepEqual(designs.map((design) => after.pictures[design].fresh), designs.map((design) => !design.startsWith('home.html')));
      assert.equal((await post(`${server.url}/api/pictures/wanted`, { scale: 0.5, scheme: 'dark', designs })).queued, 1);
      assert.ok(await until(() => events.picture.length === 3), 'made again');
      assert.ok(events.change.every((change) => !change.file.startsWith(CACHE_FOLDER)), 'writing pictures is no change to the designs');
      assert.ok(fs.existsSync(path.join(dir, CACHE_FOLDER, '.gitignore')));
    } finally {
      events.stop();
      await server.close();
      delete process.env.FAKE_CDP_LOG;
    }
  });

  test('Firefox: its page draws each design and sends it, with the files it used and the themes found', async () => {
    project();
    const browser = { path: executable(fakes, 'firefox', FAKE_FIREFOX), name: 'Fake Firefox', engine: 'firefox' };
    const server = await startServer({ dir, port: 0, host: '127.0.0.1', quiet: true, browser, headlessIdleMs: 300 });
    const events = listen(server.url);
    try {
      const designs = await keysOf(server.url);
      assert.deepEqual(await post(`${server.url}/api/pictures/wanted`, { theme: 'dark', scale: 0.25, designs }), { maker: true, queued: 2 });
      assert.ok(await until(() => events.picture.length === 2));
      const kept = await getJson(`${server.url}/api/pictures?theme=dark&scale=0.25`);
      assert.deepEqual(Object.values(kept.pictures).map(({ height, themes, fresh }) => ({ height, themes, fresh })), [
        { height: 844, themes: ['dark'], fresh: true },
        { height: 844, themes: ['dark'], fresh: true },
      ]);
      assert.match(kept.pictures[designs[0]].url, /\.png$/);
      assert.deepEqual((await getJson(`${server.url}/api/pictures?scale=0.25`)).pictures, {}, 'other themes have their own');
      fs.writeFileSync(path.join(dir, 'styles.css'), 'p { color: blue; }');
      const after = await getJson(`${server.url}/api/pictures?theme=dark&scale=0.25`);
      assert.ok(Object.values(after.pictures).every((picture) => !picture.fresh), 'both used the stylesheet');
    } finally {
      events.stop();
      await server.close();
    }
  });

  test('with no browser, the canvas is told to make them itself, and what it sends is kept', async () => {
    project();
    const server = await startServer({ dir, port: 0, host: '127.0.0.1', quiet: true, browser: null });
    try {
      const designs = await keysOf(server.url);
      assert.equal((await getJson(`${server.url}/api/pictures`)).maker, null);
      assert.deepEqual(await post(`${server.url}/api/pictures/wanted`, { designs }), { maker: false, queued: 0 });
      const sent = await fetch(`${server.url}/api/pictures`, {
        method: 'POST',
        body: JSON.stringify({ design: designs[0], scale: 0.25, height: 844, themes: [], files: [`${server.url}/${designs[0].split('|')[0]}`], since: Date.now(), type: 'image/webp', image: PNG_BASE64 }),
      });
      assert.equal(sent.status, 204);
      const kept = await getJson(`${server.url}/api/pictures`);
      assert.deepEqual(Object.keys(kept.pictures), [designs[0]]);
      assert.equal(kept.pictures[designs[0]].fresh, true);
      const wrong = await fetch(`${server.url}/api/pictures`, { method: 'POST', body: JSON.stringify({ design: designs[0], type: 'text/html', image: 'PGgxPg==' }) });
      assert.equal(wrong.status, 400);
      const unknown = await fetch(`${server.url}/api/pictures`, { method: 'POST', body: JSON.stringify({ design: 'nope.html|1|1', type: 'image/png', image: PNG_BASE64 }) });
      assert.equal(unknown.status, 404);
    } finally {
      await server.close();
    }
  });
});
