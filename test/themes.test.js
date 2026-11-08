import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, loadDesignsManifest, parseDesignMeta, buildCatalog, formatCatalog, formatReport, shotPath } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', 'bin', 'htmlboard.js');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const page = (title, head = '') => `<!DOCTYPE html>\n<html>\n<head>\n<title>${title}</title>\n<meta name="htmlboard" content="width=390, height=844">\n${head}</head>\n<body></body>\n</html>\n`;

/** A stand-in for the canvas: it answers checks and shots as the explorer would, and keeps what it was asked */
function fakeCanvas(url, asked = []) {
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
          if (event !== 'check' && event !== 'shot') continue;
          const request = JSON.parse(block.match(/^data: (.*)$/m)[1]);
          asked.push({ event, ...request });
          if (!(await fetch(`${url}/api/requests/${request.id}/claim`, { method: 'POST' })).ok) continue;
          const answer = event === 'check'
            ? { designs: request.designs.map(({ file, title }) => ({ file, title, problems: [], ...(request.theme ? { themes: [request.theme] } : {}) })) }
            : { png: PNG, width: 1, height: 1, matches: 0, ...(request.theme ? { theme: request.theme } : {}) };
          await fetch(`${url}/api/requests/${request.id}`, { method: 'POST', body: JSON.stringify(answer) });
        }
      });
    });
    req.on('error', () => {});
  });
}

describe('How designs say their themes apply', () => {
  test('<meta name="htmlboard:themes">: the attribute, then the themes', () => {
    const themes = (content) => parseDesignMeta(`<head><meta name="htmlboard:themes" content="${content}"></head>`).themes;
    assert.deepEqual(themes('light, dark'), { attribute: 'data-theme', values: ['light', 'dark'] });
    assert.deepEqual(themes('data-mode: day night'), { attribute: 'data-mode', values: ['day', 'night'] });
    assert.deepEqual(themes('class: light, dark'), { attribute: 'class', values: ['light', 'dark'] });
    assert.deepEqual(themes('data-mode:'), { attribute: 'data-mode', values: [] }); // the canvas finds them
    assert.equal(parseDesignMeta('<head><title>x</title></head>').themes, undefined);
  });

  test('designs.json says it for the project, an entry or a design for itself', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-themes-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.html'), page('A'));
      fs.writeFileSync(path.join(dir, 'b.html'), page('B', '<meta name="htmlboard:themes" content="class: dim">\n'));
      fs.writeFileSync(path.join(dir, 'c.html'), page('C'));
      fs.writeFileSync(path.join(dir, 'designs.json'), JSON.stringify({
        themes: ['light', 'dark'],
        sections: [{ name: 'All', designs: ['a.html', 'b.html', { file: 'c.html', themes: { attribute: 'data-mode', values: ['x'] } }] }]
      }));
      const manifest = loadDesignsManifest(dir);
      assert.deepEqual(manifest.themes, { attribute: 'data-theme', values: ['light', 'dark'] });
      const [a, b, c] = manifest.sections[0].artboards;
      assert.equal(a.themes, undefined); // the project's
      assert.deepEqual(b.themes, { attribute: 'class', values: ['dim'] });
      assert.deepEqual(c.themes, { attribute: 'data-mode', values: ['x'] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Checks and shots in a theme', () => {
  let dir;
  let server;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-themes-'));
    fs.mkdirSync(path.join(dir, 'designs'));
    fs.writeFileSync(path.join(dir, 'designs', 'home.html'), page('Home'));
    fs.writeFileSync(path.join(dir, 'designs', 'own.html'), page('Own', '<meta name="htmlboard:themes" content="class: dim">\n'));
    fs.writeFileSync(path.join(dir, 'designs', 'designs.json'), '{ "themes": { "attribute": "data-mode", "values": ["day", "night"] } }');
    server = await startServer({ dir: path.join(dir, 'designs'), port: 3981, browser: null });
  });
  after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the canvas gets the theme, or the themes to check in, and how each design applies them', async () => {
    const asked = [];
    const disconnect = await fakeCanvas(server.url, asked);
    try {
      await (await fetch(`${server.url}/api/check?theme=night`)).json();
      await (await fetch(`${server.url}/api/check?themes=all`)).json();
      await (await fetch(`${server.url}/api/check?themes=day,%20night`)).json();
      const shot = await (await fetch(`${server.url}/api/shot?file=home.html&theme=night`)).json();
      assert.equal(shot.theme, 'night');
      assert.deepEqual(asked.map(({ theme, themes }) => [theme, themes]), [['night', undefined], [undefined, 'all'], [undefined, ['day', 'night']], ['night', undefined]]);
      const themesOf = (request) => Object.fromEntries((request.designs ?? [request.design]).map((design) => [design.file, design.themes]));
      assert.deepEqual(themesOf(asked[0]), {
        'home.html': { attribute: 'data-mode', values: ['day', 'night'] }, // designs.json's
        'own.html': { attribute: 'class', values: ['dim'] } // its own
      });
      assert.deepEqual(themesOf(asked[3]), { 'home.html': { attribute: 'data-mode', values: ['day', 'night'] } });
    } finally {
      disconnect();
    }
  });

  const cli = (args) => new Promise((resolve) => execFile(process.execPath, [CLI, ...args], { cwd: dir },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));

  test('CLI: check --theme and --themes, shot --theme (in the name of its file)', async () => {
    const asked = [];
    const disconnect = await fakeCanvas(server.url, asked);
    try {
      const checked = await cli(['check', 'designs', '-p', '3981', '--theme', 'night']);
      assert.equal(checked.code, 0, checked.stderr);
      assert.match(checked.stdout, /^Checked 2 designs in designs, in night \(the canvas at http:\/\/localhost:3981\): no problems found\./);
      assert.equal((await cli(['check', 'designs', '-p', '3981', '--themes', 'all'])).code, 0);
      assert.equal(asked[1].themes, 'all');
      const shot = await cli(['shot', 'designs/home.html', '-p', '3981', '--theme', 'night']);
      assert.equal(shot.code, 0, shot.stderr);
      assert.equal(shot.stdout, `${shotPath(path.join(dir, 'designs'), 'home.html', { theme: 'night' })} (1 × 1)\n`);
      assert.equal(asked[2].theme, 'night');
      fs.rmSync(path.dirname(shot.stdout.split(' (')[0]), { recursive: true }); // the folder of this test's designs
    } finally {
      disconnect();
    }
    for (const args of [['check', 'designs', '--theme', 'a', '--themes', 'all'], ['check', 'designs', '--theme='], ['shot', 'designs/home.html', '--theme']]) {
      assert.equal((await cli(args)).code, 2, args.join(' '));
    }
  });
});

describe('Themes in the report', () => {
  test('the themes checked in its first line; a problem found in some of them only says which', () => {
    const report = {
      dir: '/p/designs',
      root: '/p/designs',
      designs: [
        {
          file: 'home.html', title: 'Home', themes: ['default', 'light', 'dark'],
          problems: [
            { level: 'error', kind: 'missing', path: '/logo.svg' },
            { level: 'layout', kind: 'spill', selector: '.btn', text: 'Confirm', themes: ['dark'] }
          ]
        },
        { file: 'plain.html', title: 'Plain', problems: [] }
      ]
    };
    assert.equal(formatReport(report, { name: 'designs' }), `Checked 2 designs in designs, in default, light and dark: 1 with problems.

home.html · Home
  error  missing file: logo.svg
  layout [dark] text spills out of .btn: "Confirm"
`);
  });
});

describe('Themes in the catalog', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-themes-'));
    fs.writeFileSync(path.join(dir, 'a.html'), page('A', '<link rel="stylesheet" href="styles.css">\n'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const themesLine = (css, designsJson) => {
    fs.writeFileSync(path.join(dir, 'styles.css'), css);
    if (designsJson) fs.writeFileSync(path.join(dir, 'designs.json'), designsJson);
    else fs.rmSync(path.join(dir, 'designs.json'), { force: true });
    return formatCatalog(buildCatalog(dir), { name: 'd' }).split('\n').find((line) => line.startsWith('Themes')) ?? null;
  };

  test('as the stylesheets have them: data-theme, and the system’s light and dark', () => {
    assert.equal(themesLine(':root { --bg: #fff; }\n[data-theme="dark"] { --bg: #000; }\n[data-theme=dim] .x { color: gray; }\n'),
      'Themes: dark, dim (data-theme on <html>; in styles.css): check --themes all, shot --theme <name>');
    assert.equal(themesLine(':root { color-scheme: light dark; }\n@media (prefers-color-scheme: dark) { body { color: white; } }\n'),
      'Themes: light, dark (the system’s light and dark modes; in styles.css): check --themes all, shot --theme <name>');
    assert.equal(themesLine('[data-theme="dark"] { --bg: #000; }\n@media (prefers-color-scheme: dark) { :root:not([data-theme]) { --bg: #000; } }\n'),
      'Themes: light, dark (data-theme on <html>, and the system’s light and dark modes; in styles.css): check --themes all, shot --theme <name>');
    assert.equal(themesLine('.btn { color: red; }\n'), null);
  });

  test('as designs.json says them', () => {
    assert.equal(themesLine('html.dark { --bg: #000; }\n', '{ "themes": { "attribute": "class", "values": ["dark", "contrast"] } }'),
      'Themes: dark, contrast (classes on <html>; in designs.json): check --themes all, shot --theme <name>');
    assert.equal(themesLine('html.dark { --bg: #000; } :root.dim { --bg: #333; }\n', '{ "themes": { "attribute": "class" } }'),
      'Themes: dark, dim (classes on <html>; in designs.json, styles.css): check --themes all, shot --theme <name>');
  });
});
