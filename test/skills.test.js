import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installSkills, uninstallSkills, SKILLS_DIR } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'htmlboard.js');

describe('Agent skills', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlboard-skills-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('bundled skill has a valid SKILL.md frontmatter', () => {
    const skill = fs.readFileSync(path.join(SKILLS_DIR, 'htmlboard', 'SKILL.md'), 'utf8');
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, 'SKILL.md starts with a frontmatter block');
    assert.match(frontmatter[1], /^name: htmlboard$/m);
    assert.match(frontmatter[1], /^description: .{20,1024}$/m);
  });

  test('installSkills copies the skill for every agent by default', () => {
    const results = installSkills({ dir: tmp });
    assert.deepEqual(results.map((r) => r.status), ['installed', 'installed']);
    for (const target of ['.claude/skills', '.agents/skills']) {
      assert.ok(fs.existsSync(path.join(tmp, target, 'htmlboard', 'SKILL.md')));
    }
  });

  test('installSkills honours --agent', () => {
    installSkills({ dir: tmp, agent: 'claude' });
    assert.ok(fs.existsSync(path.join(tmp, '.claude/skills/htmlboard/SKILL.md')));
    assert.ok(!fs.existsSync(path.join(tmp, '.agents')));
    assert.throws(() => installSkills({ dir: tmp, agent: 'nope' }), /Unknown agent/);
  });

  test('reinstalling is a no-op, and local edits are kept unless forced', () => {
    installSkills({ dir: tmp, agent: 'claude' });
    assert.equal(installSkills({ dir: tmp, agent: 'claude' })[0].status, 'unchanged');

    const installed = path.join(tmp, '.claude/skills/htmlboard/SKILL.md');
    fs.appendFileSync(installed, '\nMy own notes.\n');
    assert.equal(installSkills({ dir: tmp, agent: 'claude' })[0].status, 'skipped');
    assert.match(fs.readFileSync(installed, 'utf8'), /My own notes/);

    assert.equal(installSkills({ dir: tmp, agent: 'claude', force: true })[0].status, 'updated');
    assert.doesNotMatch(fs.readFileSync(installed, 'utf8'), /My own notes/);
  });

  test('uninstallSkills removes only the htmlboard skill', () => {
    installSkills({ dir: tmp });
    fs.mkdirSync(path.join(tmp, '.claude/skills/other'), { recursive: true });

    const results = uninstallSkills({ dir: tmp });
    assert.deepEqual(results.map((r) => r.status), ['removed', 'removed']);
    assert.ok(!fs.existsSync(path.join(tmp, '.claude/skills/htmlboard')));
    assert.ok(fs.existsSync(path.join(tmp, '.claude/skills/other')));
    assert.deepEqual(uninstallSkills({ dir: tmp }).map((r) => r.status), ['absent', 'absent']);
  });

  test('CLI: htmlboard skills install', () => {
    const out = execFileSync(process.execPath, [BIN, 'skills', 'install', '--agent', 'agents'], { cwd: tmp, encoding: 'utf8' });
    assert.match(out, /installed/);
    assert.ok(fs.existsSync(path.join(tmp, '.agents/skills/htmlboard/SKILL.md')));
  });
});
