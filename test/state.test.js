import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, formatState } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'htmlboard.js');
const PORT = 3993;

/** A canvas's tab, connected to the events as `name`: resolves once connected, to a function that disconnects it */
function connect(url, name) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/events${name ? `?tab=${name}` : ''}`, (res) => {
      res.on('data', (chunk) => {
        if (String(chunk).includes('event: connected')) resolve(() => new Promise((done) => {
          req.on('close', () => setTimeout(done, 50)); // the server hears it a moment later
          req.destroy();
        }));
      });
    });
    req.on('error', () => {});
  });
}

const tell = (url, shows) => fetch(`${url}/api/state`, { method: 'POST', body: JSON.stringify(shows) });
const stateOf = async (url) => (await fetch(`${url}/api/state`)).json();

function cli(args, cwd) {
  return new Promise((resolve) => execFile(process.execPath, [CLI, 'state', ...args], { cwd },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}

describe('htmlboard state', () => {
  let dir;
  let designs;
  let server;
  const customers = { file: 'designs/01-screens/02-customers.html', title: 'Customers', width: 1440, height: 900 };

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-state-'));
    designs = path.join(dir, 'designs');
    fs.mkdirSync(path.join(designs, '01-screens'), { recursive: true });
    fs.writeFileSync(path.join(designs, '01-screens', '02-customers.html'), '<!DOCTYPE html><title>Customers</title>');
    // Served from the folder above the designs: the canvas's files start with designs/
    server = await startServer({ dir: designs, root: dir, port: PORT, browser: null, quiet: true });
  });

  after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('each tab says what it shows; the one that changed last answers, until it disconnects', async () => {
    assert.deepEqual(await stateOf(server.url), { dir: designs, root: dir, open: 0, state: null });

    const a = await connect(server.url, 'a');
    assert.deepEqual(await stateOf(server.url), { dir: designs, root: dir, open: 1, state: null }, 'open, but it said nothing yet');
    assert.equal((await tell(server.url, { tab: 'a', selected: customers, theme: 'dark', filter: '', search: '' })).status, 204);
    assert.deepEqual((await stateOf(server.url)).state, {
      selected: { file: '01-screens/02-customers.html', title: 'Customers', width: 1440, height: 900 },
      element: null, theme: 'dark', filter: null, search: null,
    });

    const b = await connect(server.url, 'b');
    await tell(server.url, { tab: 'b', selected: null, theme: null, filter: 'desktop', search: 'invoice' });
    assert.deepEqual(await stateOf(server.url), {
      dir: designs, root: dir, open: 2,
      state: { selected: null, element: null, theme: null, filter: 'desktop', search: 'invoice' },
    });

    await b();
    assert.equal((await stateOf(server.url)).state.selected.file, '01-screens/02-customers.html', 'b is gone: a answers');
    await a();
    assert.deepEqual(await stateOf(server.url), { dir: designs, root: dir, open: 0, state: null });
  });

  test("a tab that isn't connected can't say what it shows (409), nor can what isn't a state (400)", async () => {
    assert.equal((await tell(server.url, { tab: 'nobody', selected: customers })).status, 409);
    assert.equal((await fetch(`${server.url}/api/state`, { method: 'POST', body: 'not json' })).status, 400);
    const unnamed = await connect(server.url); // the canvas opened out of sight names no tab
    assert.equal((await stateOf(server.url)).open, 0);
    await unnamed();
  });

  test('CLI: prints it in a few lines; exits 2 with no tab open, or no canvas', async () => {
    const disconnect = await connect(server.url, 'c');
    await tell(server.url, { tab: 'c', selected: customers, theme: 'dark', filter: 'desktop', search: 'invoice' });
    let out = await cli(['designs', '-p', String(PORT)], dir);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.stdout, 'selected: 01-screens/02-customers.html (1440 × 900) · dark\nfilter: desktop · search: "invoice"\n');

    out = await cli(['designs/01-screens', '-p', String(PORT), '--json'], dir);
    assert.deepEqual(JSON.parse(out.stdout), {
      url: `http://localhost:${PORT}`, dir: designs, open: 1,
      selected: { file: '01-screens/02-customers.html', title: 'Customers', width: 1440, height: 900 },
      element: null, theme: 'dark', filter: 'desktop', search: 'invoice',
    });

    await disconnect();
    out = await cli(['designs', '-p', String(PORT)], dir);
    assert.equal(out.code, 2);
    assert.match(out.stderr, /isn't open in a browser, so nothing is selected/);

    out = await cli([dir, '-p', String(PORT + 1)], dir);
    assert.equal(out.code, 2);
    assert.match(out.stderr, /No htmlboard is running at http:\/\/localhost:3994/);
  });

  test('as text: nothing selected, a theme on its own, an element picked, several tabs', () => {
    assert.equal(formatState({ selected: null, theme: 'dark' }), 'selected: nothing\ntheme: dark\n');
    assert.equal(formatState({
      selected: { file: 'home.html', width: 390, height: 844 },
      element: { selector: '.table tr:nth-child(3) .badge', text: 'One-time' },
    }, { open: 2 }), [
      'selected: home.html (390 × 844)',
      'element: .table tr:nth-child(3) .badge "One-time"',
      '(2 tabs have the canvas open: this is the one used last)',
      '',
    ].join('\n'));
  });
});
