import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Agent skills bundled with the package, one folder per skill */
export const SKILLS_DIR = path.join(__dirname, '..', 'skills');

/**
 * Where each agent looks for skills, relative to the project root (or the home folder with `global`).
 * `agents` is the shared Agent Skills location read by Codex and other agents.
 */
export const SKILL_TARGETS = {
  claude: path.join('.claude', 'skills'),
  agents: path.join('.agents', 'skills')
};

function bundledSkills() {
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
}

function resolveTargets(agent = 'all') {
  if (agent === 'all') return Object.keys(SKILL_TARGETS);
  if (!SKILL_TARGETS[agent]) {
    throw new Error(`Unknown agent "${agent}". Use one of: ${[...Object.keys(SKILL_TARGETS), 'all'].join(', ')}`);
  }
  return [agent];
}

/** List every file under dir as paths relative to it */
function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
  });
}

function sameTree(a, b) {
  const filesA = listFiles(a).sort();
  const filesB = listFiles(b).sort();
  return filesA.length === filesB.length &&
    filesA.every((file, i) => file === filesB[i] &&
      fs.readFileSync(path.join(a, file)).equals(fs.readFileSync(path.join(b, file))));
}

/**
 * Copy the bundled skills into the agents' skill folders.
 * An existing skill folder that differs from the bundled one is left alone unless `force` is set.
 *
 * @param {object} [options]
 * @param {'claude'|'agents'|'all'} [options.agent='all']
 * @param {boolean} [options.global=false] Install under the home folder instead of the project
 * @param {string} [options.dir=process.cwd()] Project root (ignored with `global`)
 * @param {boolean} [options.force=false] Replace skills that were changed locally
 * @returns {{skill: string, path: string, status: 'installed'|'updated'|'unchanged'|'skipped'}[]}
 */
export function installSkills({ agent = 'all', global = false, dir = process.cwd(), force = false } = {}) {
  const base = global ? os.homedir() : path.resolve(dir);
  const results = [];

  for (const target of resolveTargets(agent)) {
    for (const skill of bundledSkills()) {
      const src = path.join(SKILLS_DIR, skill);
      const dest = path.join(base, SKILL_TARGETS[target], skill);
      let status = 'installed';

      if (fs.existsSync(dest)) {
        if (sameTree(src, dest)) {
          results.push({ skill, path: dest, status: 'unchanged' });
          continue;
        }
        if (!force) {
          results.push({ skill, path: dest, status: 'skipped' });
          continue;
        }
        fs.rmSync(dest, { recursive: true, force: true });
        status = 'updated';
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
      results.push({ skill, path: dest, status });
    }
  }

  return results;
}

/**
 * Remove the bundled skills from the agents' skill folders.
 * Takes the same options as installSkills (except `force`).
 * @returns {{skill: string, path: string, status: 'removed'|'absent'}[]}
 */
export function uninstallSkills({ agent = 'all', global = false, dir = process.cwd() } = {}) {
  const base = global ? os.homedir() : path.resolve(dir);
  const results = [];

  for (const target of resolveTargets(agent)) {
    for (const skill of bundledSkills()) {
      const dest = path.join(base, SKILL_TARGETS[target], skill);
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
        results.push({ skill, path: dest, status: 'removed' });
      } else {
        results.push({ skill, path: dest, status: 'absent' });
      }
    }
  }

  return results;
}
