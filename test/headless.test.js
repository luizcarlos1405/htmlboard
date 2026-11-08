import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, formatReport } from '../src/index.js';
import { findBrowser, launchBrowser, removeLeftProfiles } from '../src/browser.js';
import { designsFolderOf } from '../src/canvases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'htmlboard.js');

// A stand-in for a browser the server opens out of sight: it opens the canvas's events at the URL it
// is given (its last argument) and answers each check with no problems and each shot with a 1 × 1
// PNG, as the canvas would. FAKE_BROWSER_LOG: a file it adds a line to ({ pid, args }) when it
// starts; FAKE_BROWSER_EXIT: an exit code to quit with at once, as a browser that fails to start.
const FAKE_BROWSER = `#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
if (process.env.FAKE_BROWSER_LOG) fs.appendFileSync(process.env.FAKE_BROWSER_LOG, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + '\\n');
if (process.env.FAKE_BROWSER_EXIT) process.exit(Number(process.env.FAKE_BROWSER_EXIT));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const page = new URL(process.argv.at(-1));
const at = (path) => new URL(path, page);
http.get(at('/api/events'), (res) => {
  let buffer = '';
  res.on('data', async (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\\n\\n'); end >= 0; end = buffer.indexOf('\\n\\n')) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = block.match(/^event: (.*)$/m)?.[1];
      if (event !== 'check' && event !== 'shot') continue;
      const request = JSON.parse(block.match(/^data: (.*)$/m)[1]);
      if (!(await fetch(at('/api/requests/' + request.id + '/claim?headless'), { method: 'POST' })).ok) continue;
      const answer = event === 'check'
        ? { designs: request.designs.map(({ file, title, width, height }) => ({ file, title, width, height: height ?? null, problems: [] })) }
        : { png: PNG, width: 1, height: 1, matches: 0 };
      await fetch(at('/api/requests/' + request.id), { method: 'POST', body: JSON.stringify(answer) });
    }
  });
  res.on('end', () => process.exit(0));
}).on('error', () => process.exit(1));
`;

const page = (title) => `<!DOCTYPE html>\n<html>\n<head>\n<title>${title}</title>\n<meta name="htmlboard" content="width=390, height=844">\n</head>\n<body><p>${title}</p></body>\n</html>\n`;

/** An executable file in dir (a stand-in for a browser, or a command on a fake PATH) */
function executable(dir, name, content = '#!/bin/sh\n') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
  return file;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const until = async (check, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 25))) if (check()) return true;
  return check();
};

const logged = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

describe('Finding a browser to open the canvas in out of sight', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-browser-find-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('Chrome, Chromium or Edge on the PATH first, then Firefox; none, none', () => {
    const bin = (name, ...commands) => {
      const folder = path.join(dir, name);
      fs.mkdirSync(folder);
      for (const command of commands) executable(folder, command);
      return folder;
    };
    const find = (PATH) => findBrowser({ env: { PATH }, platform: 'linux' });
    const firefoxOnly = bin('a', 'firefox');
    assert.deepEqual(find(bin('e', 'firefox-esr')), { path: path.join(dir, 'e', 'firefox-esr'), name: 'Firefox', engine: 'firefox' });
    const both = bin('b', 'firefox', 'chromium');
    const chrome = bin('c', 'chromium-browser', 'google-chrome-stable');
    assert.deepEqual(find(firefoxOnly), { path: path.join(firefoxOnly, 'firefox'), name: 'Firefox', engine: 'firefox' });
    assert.deepEqual(find(both), { path: path.join(both, 'chromium'), name: 'Chromium', engine: 'chromium' });
    assert.deepEqual(find(`${firefoxOnly}:${chrome}`), { path: path.join(chrome, 'google-chrome-stable'), name: 'Google Chrome', engine: 'chromium' });
    assert.equal(find(bin('d')), null);
    fs.writeFileSync(path.join(dir, 'd', 'chromium'), ''); // not executable
    assert.equal(find(path.join(dir, 'd')), null);
  });

  test('HTMLBOARD_BROWSER names one (a path or a command), or none', () => {
    const own = executable(dir, 'my-browser');
    const fox = executable(dir, 'firefox-esr');
    const find = (HTMLBOARD_BROWSER) => findBrowser({ env: { PATH: dir, HTMLBOARD_BROWSER }, platform: 'linux' });
    assert.deepEqual(find(own), { path: own, name: 'my-browser', engine: 'chromium' });
    assert.deepEqual(find('firefox-esr'), { path: fox, name: 'Firefox', engine: 'firefox' });
    assert.equal(find('none'), null);
    assert.equal(find(path.join(dir, 'not-there')), null);
    assert.equal(find('not-there'), null);
  });
});

describe('A browser out of sight', () => {
  let dir;
  let fake;
  let log;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-browser-'));
    fake = executable(dir, 'fake-browser.mjs', FAKE_BROWSER);
    log = path.join(dir, 'log');
  });
  after(() => {
    delete process.env.FAKE_BROWSER_LOG;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('opens the URL with a profile of its own, and quits with it removed', async () => {
    const server = await startServer({ dir, port: 3971, browser: null });
    process.env.FAKE_BROWSER_LOG = log;
    try {
      for (const engine of ['chromium', 'firefox']) {
        fs.rmSync(log, { force: true });
        const browser = launchBrowser({ path: fake, name: 'Fake', engine }, `${server.url}/`);
        assert.ok(await until(() => logged(log).length));
        const [{ pid, args }] = logged(log);
        assert.equal(args.at(-1), `${server.url}/`);
        const profile = engine === 'firefox' ? args[args.indexOf('--profile') + 1] : args.find((arg) => arg.startsWith('--user-data-dir=')).split('=')[1];
        assert.ok(args.includes(engine === 'firefox' ? '--headless' : '--headless=new'), args.join(' '));
        // Chromium quits once its pipe from this process closes, even if this one is killed outright
        assert.equal(args.includes('--remote-debugging-pipe'), engine === 'chromium');
        assert.equal(fs.readFileSync(path.join(profile, 'htmlboard-owner'), 'utf8'), String(process.pid));
        if (engine === 'firefox') assert.match(fs.readFileSync(path.join(profile, 'user.js'), 'utf8'), /checkDefaultBrowser", false/);
        await browser.close();
        assert.ok(!alive(pid), 'it quit');
        assert.ok(!fs.existsSync(profile), 'its profile is gone');
      }
    } finally {
      delete process.env.FAKE_BROWSER_LOG;
      await server.close();
    }
  });

  test('profiles left by an htmlboard that is gone are removed when the next browser opens', async () => {
    const gone = await new Promise((resolve) => {
      const child = execFile(process.execPath, ['-e', '']);
      child.on('exit', () => resolve(child.pid));
    });
    const profile = (owner) => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-browser-'));
      if (owner) fs.writeFileSync(path.join(folder, 'htmlboard-owner'), String(owner));
      return folder;
    };
    const left = profile(gone);
    const mine = profile(process.pid);
    const ownerless = profile(null);
    const old = profile(null);
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(old, hourAgo, hourAgo);
    try {
      removeLeftProfiles();
      assert.ok(!fs.existsSync(left), "its owner is gone");
      assert.ok(fs.existsSync(mine), 'in use');
      assert.ok(fs.existsSync(ownerless), 'maybe being made');
      assert.ok(!fs.existsSync(old), 'written in again as its browser quit, long ago');
    } finally {
      for (const folder of [left, mine, ownerless, old]) fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  test('a request with no canvas open opens one, which quits after a while without requests', async () => {
    fs.rmSync(log, { force: true });
    process.env.FAKE_BROWSER_LOG = log;
    fs.writeFileSync(path.join(dir, 'home.html'), page('Home'));
    const server = await startServer({ dir, port: 3972, browser: { path: fake, name: 'Fake', engine: 'chromium' }, headlessIdleMs: 300 });
    try {
      const [first, second] = await Promise.all([fetch(`${server.url}/api/check`), fetch(`${server.url}/api/shot?file=home.html`)]);
      assert.equal(first.status, 200);
      const report = await first.json();
      assert.equal(report.browser, 'Fake'); // done out of sight, in it
      assert.deepEqual(report.designs.map((design) => design.file), ['home.html']);
      assert.equal((await second.json()).browser, 'Fake');
      const opened = logged(log);
      assert.equal(opened.length, 1, 'one browser for both');
      assert.match(opened[0].args.at(-1), /^http:\/\/127\.0\.0\.1:3972\/\?worker$/);
      assert.ok(await until(() => !alive(opened[0].pid)), 'it quits after a while');
      assert.equal((await fetch(`${server.url}/api/check`)).status, 200);
      assert.equal(logged(log).length, 2, 'and opens again for the next request');
    } finally {
      await server.close();
      delete process.env.FAKE_BROWSER_LOG;
    }
    assert.ok(logged(log).every(({ pid }) => !alive(pid)), 'the server quits it when it stops');
  });

  test("without a browser, or with one that doesn't start, the request says so", async () => {
    fs.writeFileSync(path.join(dir, 'home.html'), page('Home'));
    let server = await startServer({ dir, port: 3973, browser: null });
    try {
      const res = await fetch(`${server.url}/api/check`);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: "The canvas isn't open in a browser, and there's no browser to open it in out of sight", browser: false });
    } finally {
      await server.close();
    }
    process.env.FAKE_BROWSER_EXIT = '3';
    server = await startServer({ dir, port: 3973, browser: { path: fake, name: 'Fake', engine: 'chromium' } });
    try {
      const res = await fetch(`${server.url}/api/check`);
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error, "Fake couldn't open the canvas (exit code 3)");
    } finally {
      delete process.env.FAKE_BROWSER_EXIT;
      await server.close();
    }
  });
});

describe('htmlboard check and shot with no canvas running', () => {
  let dir;
  let fake;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-local-'));
    fake = executable(dir, 'fake-browser.mjs', FAKE_BROWSER);
    fs.mkdirSync(path.join(dir, 'designs', '01-shop'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'designs', 'styles.css'), ':root { --ink: #111; }\n');
    fs.writeFileSync(path.join(dir, 'designs', 'home.html'), page('Home'));
    fs.writeFileSync(path.join(dir, 'designs', '01-shop', '01-cart.html'), page('Cart'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (command, args, env = {}) => new Promise((resolve) => execFile(process.execPath, [CLI, command, ...args],
    { cwd: dir, timeout: 30000, env: { ...process.env, HTMLBOARD_BROWSER: fake, ...env } },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));

  test('they start one for themselves, for the designs folder the path is in, and stop it', async () => {
    const log = path.join(dir, 'log');
    const checked = await run('check', ['designs/01-shop/01-cart.html'], { FAKE_BROWSER_LOG: log });
    assert.equal(checked.code, 0, checked.stderr);
    assert.equal(checked.stdout, 'Checked 1 design in designs (in headless fake-browser.mjs, as no canvas was running): no problems found.\n');
    const [{ pid, args }] = logged(log);
    assert.match(args.at(-1), /^http:\/\/127\.0\.0\.1:\d+\/\?worker$/);
    assert.ok(await until(() => !alive(pid)), 'its browser quit with it');

    const shot = await run('shot', ['designs/home.html', '-o', 'home.png']);
    assert.equal(shot.code, 0, shot.stderr);
    assert.equal(shot.stdout, 'home.png (1 × 1)\n');
    assert.ok(fs.statSync(path.join(dir, 'home.png')).size > 0);
  });

  test("without a browser, they say there's none and exit 2", async () => {
    const out = await run('check', ['designs'], { HTMLBOARD_BROWSER: 'none' });
    assert.equal(out.code, 2);
    assert.match(out.stderr, /^No htmlboard canvas is running for designs, and there's no browser to run the check in out of sight \(Chrome, Chromium, Edge or Firefox; HTMLBOARD_BROWSER=<path> names another\)/);
  });

  test('the designs folder of a path: the nearest one with what a designs folder has at its top', () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      assert.equal(designsFolderOf('designs/01-shop/01-cart.html'), path.join(dir, 'designs'));
      assert.equal(designsFolderOf('designs/01-shop'), path.join(dir, 'designs'));
      assert.equal(designsFolderOf('designs'), path.join(dir, 'designs'));
      fs.mkdirSync(path.join(dir, 'loose'));
      assert.equal(designsFolderOf('loose/page.html'), path.join(dir, 'loose')); // nothing marks one: its own folder
    } finally {
      process.chdir(cwd);
    }
  });

  test('the report says when only the designs folder was served and files are missing', () => {
    const report = { dir: '/p/design', root: '/p/design', designs: [{ file: 'a.html', title: 'A', problems: [{ level: 'error', kind: 'missing', path: '/css/site.css' }] }] };
    const text = formatReport(report, { name: 'design', local: true });
    assert.match(text, /^Checked 1 design in design \(in a browser, as no canvas was running\): 1 with problems\./);
    assert.match(text, /No canvas was running, so only design was served: if the designs link files outside it, add --root <folder>/);
    assert.doesNotMatch(formatReport(report, { name: 'design', url: 'http://localhost:3000' }), /--root/);
  });
});
