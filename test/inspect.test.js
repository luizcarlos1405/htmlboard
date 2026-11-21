import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, formatInspection } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'htmlboard.js');
const PORT = 3994;

const page = (title) => `<!DOCTYPE html>\n<html>\n<head>\n<title>${title}</title>\n<meta name="htmlboard" content="width=1280, height=820">\n</head>\n<body><p>${title}</p></body>\n</html>\n`;

function cli(args, cwd) {
  return new Promise((resolve) => execFile(process.execPath, [CLI, 'inspect', ...args], { cwd },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}

/**
 * A stand-in for the canvas open in a browser: it answers each inspection with answer(request), as
 * the explorer would. Resolves once connected, to a function that disconnects it; `asked` gets each
 * request it was sent.
 */
function fakeCanvas(url, answer, asked = []) {
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
          if (event !== 'inspect') continue;
          const request = JSON.parse(block.match(/^data: (.*)$/m)[1]);
          asked.push(request);
          if (!(await fetch(`${url}/api/requests/${request.id}/claim`, { method: 'POST' })).ok) continue;
          await fetch(`${url}/api/requests/${request.id}`, { method: 'POST', body: JSON.stringify(answer(request)) });
        }
      });
    });
    req.on('error', () => {});
  });
}

const ROWS = [
  { depth: 0, selector: 'table.table', x: 293, y: 185, width: 934, height: 358, text: 'Organization Plan Seats…', problems: [] },
  { depth: 1, selector: 'thead', x: 293, y: 185, width: 934, height: 28, text: 'Organization Plan Seats MRR Status', problems: [] },
  { depth: 2, selector: 'th:nth-child(2)', x: 520, y: 185, width: 140, height: 28, text: 'Plan', problems: ['text spills out'], styles: { 'font-size': '11px', gap: 'normal' } },
];
const measured = (request) => ({ width: 1280, height: 820, matches: request.selector ? 2 : 0, kind: request.selector ? 'element' : 'outline', rows: ROWS, more: 4 });

describe('htmlboard inspect', () => {
  let dir;
  let server;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-inspect-'));
    fs.mkdirSync(path.join(dir, 'designs', '01-screens'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'designs', '01-screens', '02-customers.html'), page('Customers'));
    server = await startServer({ dir: path.join(dir, 'designs'), port: PORT, browser: null, quiet: true }); // these tests play the canvas
  });
  after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the canvas gets the design and what to inspect, and its rows answer', async () => {
    const asked = [];
    const disconnect = await fakeCanvas(server.url, measured, asked);
    try {
      const res = await fetch(`${server.url}/api/inspect?file=01-screens/02-customers.html&selector=.table&styles=font-size,gap,bad;name&depth=2&theme=dark`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        file: '01-screens/02-customers.html', title: 'Customers', selector: '.table', width: 1280, height: 820,
        matches: 2, kind: 'element', rows: ROWS, more: 4,
      });
      const [request] = asked;
      assert.equal(request.design.file, '01-screens/02-customers.html');
      assert.equal(request.selector, '.table');
      assert.deepEqual(request.styles, ['font-size', 'gap'], 'a name that is no style is left out');
      assert.equal(request.depth, 2);
      assert.equal(request.theme, 'dark');

      assert.equal((await fetch(`${server.url}/api/inspect?file=nope.html`)).status, 404);
    } finally {
      disconnect();
    }
  });

  test("what can't be inspected as asked is the request's fault (422); a page that can't be measured, the canvas's (500)", async () => {
    const disconnect = await fakeCanvas(server.url, (request) => (request.selector === '.nope'
      ? { error: 'nothing in the page matches .nope', kind: 'request' }
      : { error: 'the page shows nothing' }));
    try {
      let res = await fetch(`${server.url}/api/inspect?file=01-screens/02-customers.html&selector=.nope`);
      assert.equal(res.status, 422);
      assert.equal((await res.json()).error, 'nothing in the page matches .nope');
      res = await fetch(`${server.url}/api/inspect?file=01-screens/02-customers.html`);
      assert.equal(res.status, 500);
      assert.match((await res.json()).error, /couldn't inspect 01-screens\/02-customers\.html: the page shows nothing/);
    } finally {
      disconnect();
    }
  });

  test('CLI: the rows as text, or JSON; exits 1 when it can’t inspect as asked, 2 when it can’t ask', async () => {
    const asked = [];
    let disconnect = await fakeCanvas(server.url, (request) => (request.selector === '.nope'
      ? { error: 'nothing in the page matches .nope', kind: 'request' }
      : measured(request)), asked);
    try {
      let out = await cli(['designs/01-screens/02-customers.html', '.table', '--styles', 'font-size,gap', '-p', String(PORT)], dir);
      assert.equal(out.code, 0, out.stderr);
      assert.equal(out.stdout, [
        '01-screens/02-customers.html · Customers (1280 × 820): .table (the first of 2 matches)',
        'table.table  293,185 934×358  "Organization Plan Seats…"',
        '  thead  293,185 934×28  "Organization Plan Seats MRR Status"',
        '    th:nth-child(2)  520,185 140×28  "Plan"  font-size: 11px; gap: normal  ! text spills out',
        'and 4 more (a selector, or a smaller --depth, lists fewer)',
        '',
      ].join('\n'));
      assert.deepEqual(asked.at(-1).styles, ['font-size', 'gap']);

      out = await cli(['designs/01-screens/02-customers.html', '-s', 'main', '--depth', '1', '--json', '-p', String(PORT)], dir);
      assert.equal(JSON.parse(out.stdout).rows.length, 3);
      assert.equal(asked.at(-1).depth, 1);

      out = await cli(['designs/01-screens/02-customers.html', '.nope', '-p', String(PORT)], dir);
      assert.equal(out.code, 1);
      assert.match(out.stderr, /nothing in the page matches \.nope/);

      out = await cli(['designs/01-screens/02-customers.html', '--depth', 'deep', '-p', String(PORT)], dir);
      assert.equal(out.code, 2);
      assert.match(out.stderr, /--depth needs a number of levels/);
    } finally {
      disconnect();
    }
    const out = await cli(['designs/01-screens/02-customers.html', '-p', String(PORT)], dir);
    assert.equal(out.code, 2, 'no canvas open in a browser, and no browser to open it in');
    assert.match(out.stderr, /there's no browser to run the inspection in/);
  });

  test('as text: an outline, a page with none, a theme', () => {
    const rows = [{ depth: 0, selector: 'main', x: 240, y: 0, width: 1040, height: 820, text: '', problems: [] }];
    assert.equal(formatInspection({ file: 'home.html', title: 'Home', width: 390, height: 844, kind: 'outline', rows, more: 0 }),
      'home.html · Home (390 × 844): its outline (landmarks, headings, tables, components)\nmain  240,0 1040×820\n');
    assert.match(formatInspection({ file: 'flyer.html', width: 400, height: 300, kind: 'top', rows: [], more: 0, theme: 'dark' }),
      /^flyer\.html \(400 × 300\) · dark: its first levels \(it has no landmarks or headings to outline\)\n$/);
  });
});
