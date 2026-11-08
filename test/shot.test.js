import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, shotPath } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'htmlboard.js');
// A PNG of 1 × 1 px, as the canvas would send one
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const page = (title, head = '') => `<!DOCTYPE html>\n<html>\n<head>\n<title>${title}</title>\n<meta name="htmlboard" content="width=390, height=844">\n${head}</head>\n<body><p>${title}</p></body>\n</html>\n`;

function cli(args, cwd) {
  return new Promise((resolve) => execFile(process.execPath, [CLI, 'shot', ...args], { cwd },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}

/**
 * A stand-in for the canvas open in a browser: it answers each shot with answer(request), as the
 * explorer would. Resolves once connected, to a function that disconnects it; `shots` gets each
 * request it was sent.
 */
function fakeCanvas(url, answer, shots = []) {
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
          if (event !== 'shot') continue;
          const request = JSON.parse(block.match(/^data: (.*)$/m)[1]);
          shots.push(request);
          if (!(await fetch(`${url}/api/requests/${request.id}/claim`, { method: 'POST' })).ok) continue;
          await fetch(`${url}/api/requests/${request.id}`, { method: 'POST', body: JSON.stringify(answer(request)) });
        }
      });
    });
    req.on('error', () => {});
  });
}

const drawn = (request) => ({ png: PNG.toString('base64'), width: 1, height: 1, matches: request.selector ? 3 : 0 });

describe('htmlboard shot', () => {
  let dir;
  let server;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-shot-'));
    fs.mkdirSync(path.join(dir, 'designs', '01-shop'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'designs', '01-shop', '01-cart.html'), page('Cart'));
    fs.writeFileSync(path.join(dir, 'designs', 'home.html'), page('Home', '<meta name="htmlboard:variant" content="?theme=dark · dark">\n'));
    server = await startServer({ dir: path.join(dir, 'designs'), port: 3951, browser: null }); // no browser out of sight: these tests play the canvas
  });
  after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('without a canvas open in a browser, nor one to open it in out of sight, a shot says so', async () => {
    const res = await fetch(`${server.url}/api/shot?file=home.html`);
    assert.equal(res.status, 409);
  });

  test('the canvas gets the design and what to shoot, and its PNG answers', async () => {
    const shots = [];
    const disconnect = await fakeCanvas(server.url, drawn, shots);
    try {
      const res = await fetch(`${server.url}/api/shot?file=01-shop/01-cart.html&selector=.total&max=800&scale=nope`);
      assert.equal(res.status, 200);
      const shot = await res.json();
      assert.deepEqual({ ...shot, png: undefined }, { file: '01-shop/01-cart.html', title: 'Cart', width: 1, height: 1, matches: 3, png: undefined });
      assert.deepEqual(Buffer.from(shot.png, 'base64'), PNG);
      assert.deepEqual(shots[0].design, { id: 'shop-cart', file: '01-shop/01-cart.html', title: 'Cart', width: 390, height: 844 });
      assert.equal(shots[0].selector, '.total');
      assert.equal(shots[0].max, 800);
      assert.equal(shots[0].scale, undefined); // not a number

      // A variant, with its query; the file alone is its own design
      await fetch(`${server.url}/api/shot?file=${encodeURIComponent('home.html?theme=dark')}`);
      assert.equal(shots[1].design.file, 'home.html?theme=dark');
      await fetch(`${server.url}/api/shot?file=home.html`);
      assert.equal(shots[2].design.file, 'home.html');

      const missing = await fetch(`${server.url}/api/shot?file=nope.html`);
      assert.equal(missing.status, 404);
      assert.match((await missing.json()).error, /No design on the canvas is nope\.html/);
    } finally {
      disconnect();
    }
  });

  test("what can't be shot as asked is the request's fault (422); a page that can't be drawn, the canvas's (500)", async () => {
    let disconnect = await fakeCanvas(server.url, () => ({ error: 'nothing in the page matches .nope', kind: 'request' }));
    try {
      const res = await fetch(`${server.url}/api/shot?file=home.html&selector=.nope`);
      assert.equal(res.status, 422);
      assert.equal((await res.json()).error, 'nothing in the page matches .nope');
    } finally {
      disconnect();
    }
    disconnect = await fakeCanvas(server.url, () => ({ error: 'the image is too big' }));
    try {
      const res = await fetch(`${server.url}/api/shot?file=home.html`);
      assert.equal(res.status, 500);
      assert.match((await res.json()).error, /couldn't shoot home\.html: the image is too big/);
    } finally {
      disconnect();
    }
  });

  test('CLI: saves the PNG where it is told, or in the temporary folder, and says where and how big', async () => {
    const disconnect = await fakeCanvas(server.url, drawn);
    try {
      const out = await cli(['designs/01-shop/01-cart.html', '-p', '3951', '-o', 'cart.png'], dir);
      assert.equal(out.code, 0, out.stderr);
      assert.equal(out.stdout, 'cart.png (1 × 1)\n');
      assert.deepEqual(fs.readFileSync(path.join(dir, 'cart.png')), PNG);

      const selected = await cli(['designs/home.html', '-p', '3951', '-s', '.card'], dir);
      assert.equal(selected.code, 0, selected.stderr);
      const saved = shotPath(path.join(dir, 'designs'), 'home.html', { selector: '.card' });
      assert.equal(selected.stdout, `${saved} (1 × 1)\n.card matches 3 elements: this is the first.\n`);
      assert.deepEqual(fs.readFileSync(saved), PNG);
      fs.rmSync(path.dirname(saved), { recursive: true }); // the folder of this test's designs

      const json = JSON.parse((await cli(['designs/home.html', '-p', '3951', '-o', 'home.png', '--json'], dir)).stdout);
      assert.deepEqual(json, { path: path.join(dir, 'home.png'), file: 'home.html', title: 'Home', width: 1, height: 1, matches: 0 });
    } finally {
      disconnect();
    }
  });

  test("CLI: exits 1 when the shot can't be taken as asked, 2 when it can't ask, or isn't asked right", async () => {
    const disconnect = await fakeCanvas(server.url, () => ({ error: 'nothing in the page matches .nope', kind: 'request' }));
    try {
      const failed = await cli(['designs/home.html', '-p', '3951', '-s', '.nope'], dir);
      assert.equal(failed.code, 1);
      assert.equal(failed.stderr, 'nothing in the page matches .nope.\n');
      const folder = await cli(['designs', '-p', '3951'], dir);
      assert.equal(folder.code, 1);
      assert.match(folder.stderr, /is the designs folder: say which design to shoot/);
    } finally {
      disconnect();
    }
    const unopened = await cli(['designs/home.html', '-p', '3951'], dir);
    assert.equal(unopened.code, 2);
    assert.match(unopened.stderr, /isn't open in a browser, and there's no browser to run the shot in out of sight/);
    for (const args of [[], ['a.html', 'b.html'], ['a.html', '--max', '0'], ['a.html', '--max', '9', '--scale', '2'], ['a.html', '-s'], ['a.html', '--bogus']]) {
      assert.equal((await cli(args, dir)).code, 2, args.join(' '));
    }
  });
});

describe('Where shots go without -o', () => {
  test('a folder per user and designs folder, the design and selector in the name', () => {
    const one = shotPath('/work/a/designs', '01-shop/01-cart.html', { selector: 'table .total' });
    const other = shotPath('/work/b/designs', '01-shop/01-cart.html');
    assert.ok(one.startsWith(os.tmpdir()));
    assert.match(path.basename(one), /^01-shop-01-cart--table-total\.png$/);
    assert.match(path.basename(path.dirname(one)), /^designs-[0-9a-f]{6}$/);
    assert.notEqual(path.dirname(one), path.dirname(other));
    assert.equal(path.basename(shotPath('/work/a/designs', 'home.html?theme=dark')), 'home-theme-dark.png');
  });
});
