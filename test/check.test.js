import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, formatReport } from '../src/index.js';
import { withProbe } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'htmlboard.js');
const PROBE = '<script src="/__explorer/probe.js"></script>';

const page = (title, extra = '') => `<!DOCTYPE html>\n<html>\n<head>\n<title>${title}</title>\n<meta name="htmlboard" content="width=390, height=844">\n</head>\n<body>${extra}</body>\n</html>\n`;

function cli(args, cwd) {
  return new Promise((resolve) => execFile(process.execPath, [CLI, 'check', ...args], { cwd },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}

/**
 * A stand-in for the canvas open in a browser: it listens to the events and answers each check with
 * answer(designs) (a report's designs), as the explorer would. Resolves once connected, to a function
 * that disconnects it; `checks` gets each check it was sent, `done` each one it claimed and answered.
 * `route`: where it claims and answers (a canvas from before shots used /api/check/…).
 */
function fakeCanvas(url, answer, checks = [], { route = 'requests', done = [] } = {}) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/events`, (res) => {
      let buffer = '';
      res.on('data', async (chunk) => {
        buffer += chunk;
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = block.match(/^event: (.*)$/m)?.[1];
          if (event === 'connected') resolve(() => req.destroy());
          if (event !== 'check') continue;
          const request = JSON.parse(block.match(/^data: (.*)$/m)[1]);
          checks.push(request);
          const claim = await fetch(`${url}/api/${route}/${request.id}/claim`, { method: 'POST' });
          if (!claim.ok) continue;
          done.push(request.id);
          await fetch(`${url}/api/${route}/${request.id}`, { method: 'POST', body: JSON.stringify(answer(request.designs)) });
        }
      });
    });
    req.on('error', () => {});
  });
}

describe('The probe goes first in the pages shown in frames', () => {
  test('after <head>, else after <html> or <!DOCTYPE>, else at the start; bytes kept as they are', () => {
    const put = (html) => withProbe(Buffer.from(html, 'latin1')).toString('latin1');
    assert.equal(put('<!DOCTYPE html><html><head><title>x</title></head></html>'), `<!DOCTYPE html><html><head>${PROBE}<title>x</title></head></html>`);
    assert.equal(put('<!doctype html>\n<HTML lang="en"><body>x</body>'), `<!doctype html>\n<HTML lang="en">${PROBE}<body>x</body>`);
    assert.equal(put('<!DOCTYPE html><p>x'), `<!DOCTYPE html>${PROBE}<p>x`);
    assert.equal(put('<header>x</header>'), `${PROBE}<header>x</header>`);
    assert.equal(put('<head>caf\xe9</head>'), `<head>${PROBE}caf\xe9</head>`); // not UTF-8: left alone
  });
});

describe('htmlboard check', () => {
  let dir;
  let server;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-check-'));
    fs.mkdirSync(path.join(dir, 'designs', '01-shop'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'designs', 'components'));
    fs.writeFileSync(path.join(dir, 'designs', '01-shop', '01-cart.html'), page('Cart'));
    fs.writeFileSync(path.join(dir, 'designs', '01-shop', '02-pay.html'), page('Pay'));
    fs.writeFileSync(path.join(dir, 'designs', 'home.html'), page('Home'));
    fs.writeFileSync(path.join(dir, 'designs', 'components', 'x-tag.html'), '<!-- <x-tag></x-tag> -->\n<b>tag</b>\n');
    fs.writeFileSync(path.join(dir, 'designs', 'designs.json'), '{ "components": "show" }');
    server = await startServer({ dir: path.join(dir, 'designs'), port: 3941, browser: null }); // no browser out of sight: these tests play the canvas
  });
  after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('pages asked for by a frame get the probe; pages opened on their own, and HEAD, as they are', async () => {
    const framed = await (await fetch(`${server.url}/home.html`, { headers: { 'Sec-Fetch-Dest': 'iframe' } })).text();
    assert.ok(framed.startsWith(`<!DOCTYPE html>\n<html>\n<head>${PROBE}\n<title>Home</title>`));
    assert.equal(await (await fetch(`${server.url}/home.html`)).text(), page('Home'));
    const preview = await (await fetch(`${server.url}/components/x-tag.html?preview`, { headers: { 'Sec-Fetch-Dest': 'iframe' } })).text();
    assert.ok(preview.includes(`<head>${PROBE}`));
    assert.equal((await fetch(`${server.url}/__explorer/probe.js`)).status, 200);
    const head = await fetch(`${server.url}/home.html`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(`${server.url}/nope.png`, { method: 'HEAD' })).status, 404);
  });

  test('without a canvas open in a browser, nor one to open it in out of sight, a check says so', async () => {
    const res = await fetch(`${server.url}/api/check`);
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /isn't open in a browser, and there's no browser to open it in out of sight/);
  });

  test('the canvas gets the designs to check, the first to claim does it, and its report answers', async () => {
    const checks = [];
    const second = [];
    const done = [];
    const report = (designs) => ({
      designs: designs.map(({ file, title, width, height }) => ({ file, title, width, height: height ?? null, problems: [] }))
    });
    const disconnect = await fakeCanvas(server.url, report, checks, { done });
    const late = await fakeCanvas(server.url, report, second, { done });
    try {
      const res = await fetch(`${server.url}/api/check`);
      assert.equal(res.status, 200);
      const report = await res.json();
      assert.equal(report.dir, path.join(dir, 'designs'));
      // Every design on the canvas, components shown by designs.json too
      assert.deepEqual(report.designs.map((design) => design.file), ['home.html', '01-shop/01-cart.html', '01-shop/02-pay.html', 'components/x-tag.html?preview']);
      assert.deepEqual(checks[0].designs[1], { id: 'shop-cart', file: '01-shop/01-cart.html', title: 'Cart', width: 390, height: 844 });
      assert.equal(second.length, 1); // both canvases heard of the check, and one of them did it
      assert.deepEqual(done, [checks[0].id]);

      // A file or a folder of them
      const one = await (await fetch(`${server.url}/api/check?only=01-shop/02-pay.html`)).json();
      assert.deepEqual(one.designs.map((design) => design.file), ['01-shop/02-pay.html']);
      const folder = await (await fetch(`${server.url}/api/check?only=01-shop/`)).json();
      assert.deepEqual(folder.designs.map((design) => design.file), ['01-shop/01-cart.html', '01-shop/02-pay.html']);
      assert.deepEqual(done, checks.map((check) => check.id)); // each check done once, by one of them
      const none = await fetch(`${server.url}/api/check?only=02-nothing`);
      assert.equal(none.status, 404);
      assert.match((await none.json()).error, /No design on the canvas is in 02-nothing/);
    } finally {
      disconnect();
      late();
    }
  });

  test('a canvas from before shots claims and answers at /api/check/…', async () => {
    const disconnect = await fakeCanvas(server.url, (designs) => ({
      designs: designs.map(({ file, title }) => ({ file, title, problems: [] }))
    }), [], { route: 'check' });
    try {
      const res = await fetch(`${server.url}/api/check?only=home.html`);
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).designs.map((design) => design.file), ['home.html']);
    } finally {
      disconnect();
    }
  });

  test("an answer that isn't one is refused, and the request waits for a real one", async () => {
    const events = await new Promise((resolve) => {
      const req = http.get(`${server.url}/api/events`, (res) => {
        let buffer = '';
        const waiting = [];
        res.on('data', (chunk) => {
          buffer += chunk;
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (/^event: connected$/m.test(block)) resolve({ next: () => new Promise((r) => waiting.push(r)), close: () => req.destroy() });
            if (/^event: check$/m.test(block)) waiting.shift()?.(JSON.parse(block.match(/^data: (.*)$/m)[1]));
          }
        });
      });
    });
    try {
      const asked = events.next();
      const checked = fetch(`${server.url}/api/check?only=home.html`);
      const { id } = await asked;
      assert.equal((await fetch(`${server.url}/api/requests/${id}/claim`, { method: 'POST' })).status, 200);
      for (const body of ['null', '"text"', '{ not json']) {
        assert.equal((await fetch(`${server.url}/api/requests/${id}`, { method: 'POST', body })).status, 400, body);
      }
      await fetch(`${server.url}/api/requests/${id}`, { method: 'POST', body: JSON.stringify({ designs: [] }) });
      assert.equal((await checked).status, 200);
    } finally {
      events.close();
    }
  });

  test('a canvas that fails says why', async () => {
    const disconnect = await fakeCanvas(server.url, () => ({ error: 'out of memory' }));
    try {
      const res = await fetch(`${server.url}/api/check`);
      assert.equal(res.status, 500);
      assert.match((await res.json()).error, /couldn't check the designs: out of memory/);
    } finally {
      disconnect();
    }
  });

  test('CLI: finds the canvas for the folder, prints the problems, exits 1', async () => {
    const disconnect = await fakeCanvas(server.url, (designs) => ({
      designs: designs.map(({ file, title }) => ({
        file, title, width: 390, height: 844,
        problems: file === '01-shop/01-cart.html'
          ? [{ level: 'layout', kind: 'beyond', frame: 390, elements: [{ selector: '.row', right: 520 }] },
            { level: 'error', kind: 'missing', path: '/img/logo.png', tag: 'img' }]
          : []
      }))
    }));
    try {
      const out = await cli(['designs/01-shop', '-p', '3941'], dir);
      assert.equal(out.code, 1, out.stderr);
      assert.equal(out.stdout, `Checked 2 designs in designs (the canvas at http://localhost:3941): 1 with problems.

01-shop/01-cart.html · Cart
  error  missing file: img/logo.png (<img>)
  layout cut at the right edge (the frame is 390 px wide): .row reaches 520
`);
      const json = JSON.parse((await cli(['designs/home.html', '-p', '3941', '--json'], dir)).stdout);
      assert.deepEqual(json.designs.map((design) => [design.file, design.problems.length]), [['home.html', 0]]);
      assert.equal((await cli(['designs/home.html', '-p', '3941'], dir)).code, 0);
    } finally {
      disconnect();
    }
  });

  test('CLI: with no canvas at the port, or none open in a browser nor a browser to open, it says so and exits 2', async () => {
    const closed = await cli(['designs', '-p', '3949'], dir);
    assert.equal(closed.code, 2);
    assert.match(closed.stderr, /No htmlboard is running at http:\/\/localhost:3949/);
    const unopened = await cli(['designs', '-p', '3941'], dir);
    assert.equal(unopened.code, 2);
    assert.match(unopened.stderr, /The canvas at http:\/\/localhost:3941 isn't open in a browser, and there's no browser to run the check in out of sight/);
    assert.equal((await cli(['--bogus'], dir)).code, 2);
  });
});

describe('The report as text', () => {
  test('paths from the designs folder (the canvas may serve a folder above), errors first', () => {
    const report = {
      dir: '/project/design',
      root: '/project',
      designs: [
        { file: 'design/a.html', title: 'A', problems: [] },
        {
          file: 'design/b.html?theme=dark',
          title: 'B · dark',
          problems: [
            { level: 'note', kind: 'below', bottom: 1200, frame: 844 },
            { level: 'layout', kind: 'cut', selector: 'p.plan', overflow: 'hidden', text: 'Enterprise annual plan', count: 3 },
            { level: 'layout', kind: 'spill', selector: '<tx-item> .amount', text: '+$3,450.00' },
            { level: 'layout', kind: 'cut', more: 2 },
            { level: 'error', kind: 'missing', path: '/css/site.css', tag: 'link' },
            { level: 'error', kind: 'component', tag: 'tx-iten', path: '/design/components/tx-iten.html', found: false },
            { level: 'error', kind: 'script', message: 'TypeError: x is null', source: '/design/b.html', line: 12, count: 4 },
            { level: 'error', kind: 'load', tag: 'img', url: 'https://cdn.example.com/a.png' },
            { level: 'error', kind: 'font', family: 'Brand Sans' }
          ]
        },
        { file: 'design/c.html', title: 'C', problems: [{ level: 'note', kind: 'below', bottom: 900, frame: 844 }] }
      ]
    };
    assert.equal(formatReport(report, { name: 'design' }), `Checked 3 designs in design: 1 with problems, 1 with notes.

b.html?theme=dark · B · dark
  error  TypeError: x is null (b.html:12) (4 times)
  error  <tx-iten> isn't built: there is no components/tx-iten.html
  error  missing file: ../css/site.css (<link>)
  error  <img> couldn't load https://cdn.example.com/a.png
  error  font "Brand Sans" didn't load
  layout text cut off by p.plan (overflow: hidden): "Enterprise annual plan" and 2 more
  layout and 2 more boxes cut text off
  layout text spills out of <tx-item> .amount: "+$3,450.00"
  note   content goes on below the frame, down to 1200 px (the frame is 844 px tall)

c.html · C
  note   content goes on below the frame, down to 900 px (the frame is 844 px tall)
`);
  });
});
