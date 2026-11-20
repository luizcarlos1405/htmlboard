import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installSkills, uninstallSkills, SKILLS_DIR, LOCK_FILE } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'htmlboard.js');
const SKILLS = ['htmlboard', 'htmlboard-components', 'htmlboard-designs-json'];
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/**
 * Another htmlboard release, made in dir: this package's skills modules and skills, at `version`, with
 * a line added to the htmlboard skill. Returns its installSkills.
 */
async function release(dir, version, line = 'A line from another release.') {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const file of ['skills.js', 'lock.js']) fs.copyFileSync(path.join(ROOT, 'src', file), path.join(dir, 'src', file));
  fs.cpSync(SKILLS_DIR, path.join(dir, 'skills'), { recursive: true });
  fs.appendFileSync(path.join(dir, 'skills', 'htmlboard', 'SKILL.md'), `\n${line}\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version, type: 'module' }));
  return (await import(pathToFileURL(path.join(dir, 'src', 'skills.js')).href)).installSkills;
}

describe('Agent skills', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-skills-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('each bundled skill has a valid SKILL.md frontmatter, named after its folder', () => {
    const bundled = fs.readdirSync(SKILLS_DIR).filter((name) => fs.existsSync(path.join(SKILLS_DIR, name, 'SKILL.md'))).sort();
    assert.deepEqual(bundled, SKILLS);
    for (const name of SKILLS) {
      const skill = fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
      const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
      assert.ok(frontmatter, `${name}: SKILL.md starts with a frontmatter block`);
      assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, 'm'));
      assert.match(frontmatter[1], /^description: .{20,1024}$/m);
    }
    // The main skill says when to use the others
    const main = fs.readFileSync(path.join(SKILLS_DIR, 'htmlboard', 'SKILL.md'), 'utf8');
    for (const name of SKILLS.slice(1)) assert.ok(main.includes(`**${name}**`), name);
  });

  test('installSkills copies the skills for every agent by default', () => {
    const results = installSkills({ dir: tmp });
    assert.deepEqual(results.map((r) => r.status), Array(SKILLS.length * 2).fill('installed'));
    for (const target of ['.claude/skills', '.agents/skills']) {
      for (const name of SKILLS) assert.ok(fs.existsSync(path.join(tmp, target, name, 'SKILL.md')), `${target}/${name}`);
    }
  });

  test('installSkills honours --agent', () => {
    installSkills({ dir: tmp, agent: 'claude' });
    assert.ok(fs.existsSync(path.join(tmp, '.claude/skills/htmlboard/SKILL.md')));
    assert.ok(!fs.existsSync(path.join(tmp, '.agents')));
    assert.throws(() => installSkills({ dir: tmp, agent: 'nope' }), /Unknown agent/);
  });

  test('installSkills locks what it wrote beside each SKILL.md, and reinstalling is a no-op', () => {
    installSkills({ dir: tmp, agent: 'claude' });
    const skill = path.join(tmp, '.claude/skills/htmlboard');
    const lock = fs.readFileSync(path.join(skill, LOCK_FILE), 'utf8');
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(skill, 'SKILL.md'))).digest('hex');
    assert.deepEqual(JSON.parse(lock), { htmlboard: VERSION, files: { 'SKILL.md': sha256 } });

    assert.deepEqual(installSkills({ dir: tmp, agent: 'claude' }).map((r) => r.status), Array(SKILLS.length).fill('unchanged'));
    assert.equal(fs.readFileSync(path.join(skill, LOCK_FILE), 'utf8'), lock);
  });

  test('an upgrade updates a skill nobody changed, with no --force', async () => {
    installSkills({ dir: tmp, agent: 'claude' });
    const next = await release(path.join(tmp, 'next'), '999.0.0');

    assert.deepEqual(next({ dir: tmp, agent: 'claude' }).map((r) => r.status), ['updated', 'unchanged', 'unchanged']);
    const skill = path.join(tmp, '.claude/skills/htmlboard');
    assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /A line from another release/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(skill, LOCK_FILE), 'utf8')).htmlboard, '999.0.0');
  });

  test('a skill changed locally is kept after an upgrade, and --force replaces it', async () => {
    installSkills({ dir: tmp, agent: 'claude' });
    const installed = path.join(tmp, '.claude/skills/htmlboard/SKILL.md');
    fs.appendFileSync(installed, '\nMy own notes.\n');
    assert.deepEqual(installSkills({ dir: tmp, agent: 'claude' })[0], { skill: 'htmlboard', path: path.dirname(installed), status: 'skipped', reason: 'edited' });

    const next = await release(path.join(tmp, 'next'), '999.0.0');
    assert.equal(next({ dir: tmp, agent: 'claude' })[0].reason, 'edited');
    assert.match(fs.readFileSync(installed, 'utf8'), /My own notes/);

    assert.equal(next({ dir: tmp, agent: 'claude', force: true })[0].status, 'updated');
    assert.doesNotMatch(fs.readFileSync(installed, 'utf8'), /My own notes/);
    assert.match(fs.readFileSync(installed, 'utf8'), /A line from another release/);
  });

  test('a file added to a skill, or taken out of it, is a local change', () => {
    installSkills({ dir: tmp, agent: 'claude' });
    const skill = path.join(tmp, '.claude/skills/htmlboard');
    fs.writeFileSync(path.join(skill, 'notes.md'), 'Mine.\n');
    assert.equal(installSkills({ dir: tmp, agent: 'claude' })[0].reason, 'edited');
    assert.ok(fs.existsSync(path.join(skill, 'notes.md')));

    fs.rmSync(path.join(skill, 'notes.md'));
    fs.rmSync(path.join(skill, 'SKILL.md'));
    assert.equal(installSkills({ dir: tmp, agent: 'claude' })[0].reason, 'edited');
  });

  test('a skill with no lock is kept, since nothing tells it from an edited one; --force replaces it once', async () => {
    installSkills({ dir: tmp, agent: 'claude' });
    const skill = path.join(tmp, '.claude/skills/htmlboard');
    fs.rmSync(path.join(skill, LOCK_FILE)); // as htmlboard 0.10.0 and older left it
    const next = await release(path.join(tmp, 'next'), '999.0.0');

    assert.equal(next({ dir: tmp, agent: 'claude' })[0].reason, 'unrecorded');
    assert.doesNotMatch(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /A line from another release/);
    assert.equal(next({ dir: tmp, agent: 'claude', force: true })[0].status, 'updated');
    assert.ok(fs.existsSync(path.join(skill, LOCK_FILE)));

    const later = await release(path.join(tmp, 'later'), '1000.0.0', 'A line from a later release.');
    assert.equal(later({ dir: tmp, agent: 'claude' })[0].status, 'updated');
    assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /A line from a later release/);
  });

  test('an up-to-date skill with no lock gets one, so the next upgrade updates it', async () => {
    installSkills({ dir: tmp, agent: 'claude' });
    for (const name of SKILLS) fs.rmSync(path.join(tmp, '.claude/skills', name, LOCK_FILE));

    assert.deepEqual(installSkills({ dir: tmp, agent: 'claude' }).map((r) => r.status), Array(SKILLS.length).fill('unchanged'));
    for (const name of SKILLS) assert.ok(fs.existsSync(path.join(tmp, '.claude/skills', name, LOCK_FILE)), name);

    const next = await release(path.join(tmp, 'next'), '999.0.0');
    assert.equal(next({ dir: tmp, agent: 'claude' })[0].status, 'updated');
  });

  test('a skill a newer htmlboard installed is kept, so an older one doesn\'t take it back', async () => {
    const next = await release(path.join(tmp, 'next'), '999.0.0');
    next({ dir: tmp, agent: 'claude' });
    const installed = path.join(tmp, '.claude/skills/htmlboard/SKILL.md');

    assert.deepEqual(installSkills({ dir: tmp, agent: 'claude' }).map((r) => r.reason || r.status), ['newer', 'unchanged', 'unchanged']);
    assert.match(fs.readFileSync(installed, 'utf8'), /A line from another release/);
    assert.equal(installSkills({ dir: tmp, agent: 'claude', force: true })[0].status, 'updated');
    assert.doesNotMatch(fs.readFileSync(installed, 'utf8'), /A line from another release/);
  });

  test('CRLF line endings are no change, and a skill folder that is a symlink stays one', async () => {
    installSkills({ dir: tmp, agent: 'agents' });
    const real = path.join(tmp, '.agents/skills/htmlboard');
    fs.mkdirSync(path.join(tmp, '.claude/skills'), { recursive: true });
    fs.symlinkSync(real, path.join(tmp, '.claude/skills/htmlboard'), 'dir');
    // A checkout with core.autocrlf
    const skillFile = path.join(real, 'SKILL.md');
    fs.writeFileSync(skillFile, fs.readFileSync(skillFile, 'utf8').replaceAll('\n', '\r\n'));
    assert.equal(installSkills({ dir: tmp, agent: 'agents' })[0].status, 'unchanged');

    const next = await release(path.join(tmp, 'next'), '999.0.0');
    assert.equal(next({ dir: tmp, agent: 'claude' })[0].status, 'updated');
    assert.ok(fs.lstatSync(path.join(tmp, '.claude/skills/htmlboard')).isSymbolicLink());
    assert.match(fs.readFileSync(skillFile, 'utf8'), /A line from another release/);
    assert.equal(next({ dir: tmp, agent: 'agents' })[0].status, 'unchanged');
  });

  test('uninstallSkills removes only the htmlboard skills', () => {
    installSkills({ dir: tmp });
    fs.mkdirSync(path.join(tmp, '.claude/skills/other'), { recursive: true });

    const results = uninstallSkills({ dir: tmp });
    assert.deepEqual(results.map((r) => r.status), Array(SKILLS.length * 2).fill('removed'));
    for (const name of SKILLS) assert.ok(!fs.existsSync(path.join(tmp, '.claude/skills', name)));
    assert.ok(fs.existsSync(path.join(tmp, '.claude/skills/other')));
    assert.deepEqual(uninstallSkills({ dir: tmp }).map((r) => r.status), Array(SKILLS.length * 2).fill('absent'));
  });

  test('CLI: htmlboard skills install', () => {
    const out = execFileSync(process.execPath, [BIN, 'skills', 'install', '--agent', 'agents'], { cwd: tmp, encoding: 'utf8' });
    assert.match(out, /installed/);
    assert.ok(fs.existsSync(path.join(tmp, '.agents/skills/htmlboard/SKILL.md')));
  });

  test('CLI: says why it kept a skill', async () => {
    const next = await release(path.join(tmp, 'next'), '999.0.0');
    next({ dir: tmp, agent: 'claude' });
    installSkills({ dir: tmp, agent: 'agents' });
    fs.appendFileSync(path.join(tmp, '.agents/skills/htmlboard/SKILL.md'), '\nMy own notes.\n');
    fs.rmSync(path.join(tmp, '.agents/skills/htmlboard-components', LOCK_FILE));
    fs.appendFileSync(path.join(tmp, '.agents/skills/htmlboard-components/SKILL.md'), '\nFrom an older release.\n');

    const out = execFileSync(process.execPath, [BIN, 'skills', 'install'], { cwd: tmp, encoding: 'utf8' });
    assert.match(out, /installed by a newer htmlboard, kept \(use --force to replace\)\S*  \.claude\/skills\/htmlboard\n/);
    assert.match(out, /changed locally, kept \(use --force to replace\)\S*  \.agents\/skills\/htmlboard\n/);
    assert.match(out, /can't tell if it was changed locally, kept \(use --force to replace\)\S*  \.agents\/skills\/htmlboard-components\n/);
    assert.match(out, /installed by htmlboard 0\.10\.0 or older have no record/);
    assert.doesNotMatch(out, /Restart your agent session/);
  });
});
